# Outbound API — KC-Dashboard

Read-only feed of revenue, approved budget and actual spend. Versioned at
`/api/external/v1/`.

---

## The key carries no scoping — read this first

Inside the portal, who sees which budget and spend figures is decided **per person**: a budget
owner sees the segments in their `bo_scopes` rows, an employee sees the departments on their
`people` row, and `lib/spend.ts#scopeFilter` enforces it on every read.

**None of that applies to this API.** A caller holding the key sees **every company, every
department, every category, for any fiscal year**. There is no per-key scope, no per-department
key, and no way to issue a narrower one without building that mechanism first.

Treat the key as equivalent to **full finance-wide read access**, and do not assume the portal's
permission model constrains anything downstream of it.

---

## Authentication

Every request needs the key in a header:

```
x-api-key: <KC_DASHBOARD_API_KEY>
```

| condition | response |
|---|---|
| header absent | `401 { "error": "Missing x-api-key header." }` |
| key wrong | `401 { "error": "Invalid API key." }` |
| `KC_DASHBOARD_API_KEY` unset on the server | `503` — **fails closed**, so deploying without it cannot publish data |
| over the rate limit | `429` with `retry_after_seconds` |
| any verb other than GET | `405` |

Keys are compared in constant time over a SHA-256 digest, so the value cannot be probed by
timing, and length differences leak nothing.

### Rate limit

**60 requests per minute**, counted per key.

The count comes from the call log table, not from an in-process counter. This app runs on
Vercel, where each lambda instance would hold its own counter — an in-memory limiter would cap
each instance separately and the real ceiling would become *limit × instances*, which is no
ceiling at all. If the log is unreadable the request is **refused**, because an unenforceable
limit is not a limit.

### Call logging

Every request writes a row to `external_api_calls`: timestamp, endpoint, key label, HTTP status,
query string, and the forwarded IP where present. The key label identifies *which key* was used
(`kc-dashboard`), never a person.

---

## What is never returned

No requester emails, no descriptions, no supplier names, no request IDs, no budget-owner emails —
**aggregate figures only**.

This is structural, not a filter. `/budget` and `/spend` read pre-aggregated views
(`v_budget_current`, `v_spend_by_segment_month`) in which the identifying columns are not
present. `v_budget_current` does carry `owner_email`; it is deliberately not selected.

---

## Endpoints

All take `fiscal_year` (required) and `company` (optional — `ONEST` or `SV`; omit for both).

### `GET /api/external/v1/revenue`

Revenue goal and actual per channel per month.

```
GET /api/external/v1/revenue?fiscal_year=2026&company=ONEST
```

```jsonc
{
  "version": "v1",
  "generated_at": "2026-09-30T…Z",
  "fiscal_year": 2026,
  "company": "ONEST",
  "currency": "THB",
  "note": "actual = null means not yet known; it is never reported as 0.",
  "channels": [
    {
      "company": "ONEST",
      "category": "Online",
      "sub_category": "E-commerce",
      "channel": "Shopee",
      "active": true,
      "months": [
        { "month": 1, "goal": 0, "actual": 0, "actual_source": "sheet" }
        // … 12 entries
      ],
      "goal_total": 0,
      "actual_total": 0
    }
  ]
}
```

**`actual: null` means "not yet known" and is never `0`.** A zero would assert the business took
nothing in a month nobody has lived through. Do not coalesce it to zero downstream; a percentage
built on it would be wrong. `actual_source` is `"sheet"` (imported) or `"manual"` (typed by a
CEO/admin), or `null` when no actual exists.

### `GET /api/external/v1/budget`

**Approved** budget per company / department / cat_l1 / cat_l2 per month.

```
GET /api/external/v1/budget?fiscal_year=2026
```

```jsonc
{
  "version": "v1", "fiscal_year": 2026, "company": "ALL",
  "currency": "THB", "status": "APPROVED",
  "total": 0,
  "lines": [
    {
      "company": "ONEST", "department": "Retail",
      "cat_l1": "Utilities", "cat_l2": "Water",
      "months": [{ "month": 1, "amount": 0 } /* … 12 */],
      "total": 0
    }
  ]
}
```

**A draft or submitted revision can never appear.** This reads `v_budget_current`, whose
definition carries `where r.status = 'APPROVED'` — the guarantee is in SQL, not in a filter here
that a later edit could drop. `cat_l2` is `null` where the category has no second level.

### `GET /api/external/v1/spend`

Actual spend at the same grain.

```
GET /api/external/v1/spend?fiscal_year=2026&basis=approved
```

`basis` is `approved` (default) or `paid`. The response states which was used **and the statuses
behind it**, because the two differ by real money and a dashboard that silently picks one
misreports:

```jsonc
{
  "version": "v1", "fiscal_year": 2026, "company": "ALL",
  "currency": "THB",
  "basis": "approved",
  "basis_statuses": ["CEO_APPROVED", "PAID"],
  "note": "company is the company the expense is charged to (use_for_company), not the filing business unit.",
  "total": 0,
  "lines": [ /* same shape as /budget */ ]
}
```

**`company` means the company the expense is charged to** (`use_for_company`), which is what
budget ownership keys on since migration 039 — not the business unit the request was filed
under. 24% of requests differ between the two, so this matters when reconciling against another
source.

---

## Rotating the key

1. Generate a new value — e.g. `openssl rand -hex 32`. Do not commit it anywhere.
2. In the Vercel project, set `KC_DASHBOARD_API_KEY` to the new value (Production, and Preview
   if KC-Dashboard points at a preview URL).
3. Redeploy, or trigger a redeploy — environment variables are read at runtime per invocation,
   but a redeploy guarantees every instance picks it up.
4. Update the key in KC-Dashboard.

There is **one key and no overlap window**: the moment step 3 takes effect, requests with the old
key get `401` until step 4 is done. Plan the two together, or accept a gap. Supporting two valid
keys at once would need a second env var and a change to `lib/external-api.ts`.

Check `external_api_calls` after rotating: a run of `401`s with `key_label = 'unauthenticated'`
means KC-Dashboard is still presenting the old key.

---

## Versioning

The path is `/v1/` and every response carries `"version": "v1"`. Fields may be **added** within
v1; existing field names, types and meanings will not change. A breaking change gets `/v2/`, and
`/v1/` keeps working until KC-Dashboard has moved.

---

## Auditing revenue edits

Separately from this API, every revenue goal and actual edit now writes an `audit_log` row —
`REVENUE_GOAL_UPDATED` / `REVENUE_ACTUAL_UPDATED` — carrying who, the channel, the year, the
month, and the before/after of each cell that actually moved. `source` distinguishes `"manual"`
from `"sheet"`. Unchanged cells are not recorded, so re-running the same import is silent rather
than logging 156 non-events.
