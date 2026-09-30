# Outbound API — KC-Dashboard

Read-only feed of **revenue goals and actuals**. Nothing else. Versioned at
`/api/external/v1/`.

---

## Cost figures are deliberately not here — read this before adding any

This API carried `/budget` and `/spend` during development. **Both were deleted before first
use**, and the reason needs to survive the deletion:

- KC-Dashboard is **open to everyone in the company**.
- A key carries **no scoping** (next section), so every reader of that dashboard would get the
  full cost breakdown at `cat_l2` grain — **salary lines included**.
- The portal restricts exactly that per person. `lib/spend.ts#scopeFilter` limits a budget owner
  to the segments in their `bo_scopes` rows, and someone with no budget role never reaches the
  figures. Publishing costs through an unscoped key would route around a restriction the portal
  makes on purpose.

**Revenue differs in kind, not just in degree.** It is a company top line that the portal does
not restrict per person either, so exposing it withholds nothing the portal itself protects.

If a cost figure is wanted downstream later, that is a **new decision about who may see
salary-bearing detail**, and it needs per-key scoping built first. It is not a matter of
restoring a deleted file. The same paragraph is in
`app/api/external/v1/revenue/route.ts`'s header.

---

## The key carries no scoping — read this first

Inside the portal, who sees which figures is decided **per person**: a budget owner sees the
segments in their `bo_scopes` rows, an employee sees the departments on their `people` row, and
`lib/spend.ts#scopeFilter` enforces it on every read.

**None of that applies to this API.** A caller holding the key sees **everything this API
exposes, for any company and any fiscal year**. There is no per-key scope, no per-department key,
and no way to issue a narrower one without building that mechanism first.

That is the whole reason the surface is limited to revenue (previous section). Do not assume the
portal's permission model constrains anything downstream of this key — it constrains nothing.
What keeps restricted data out of KC-Dashboard is that **no endpoint returns it**, not that the
key is limited.

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
**aggregate figures only**. And no cost figures at all, per the first section.

This is structural, not a filter. The one endpoint reads `revenue_channels` and `revenue_goals`,
neither of which carries a person: a channel is a sales route, and a goal row is a figure against
a channel, month and year.

---

## Endpoints

There is **one**, and it is `GET`. It takes `fiscal_year` (required) and `company` (optional —
`ONEST` or `SV`; omit for both).

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

### Endpoints that do not exist

`/api/external/v1/budget` and `/api/external/v1/spend` return **404**. They are absent, not
disabled — see the first section for why, and do not re-add them without making that decision
again.

Any verb other than `GET` on the revenue endpoint returns **405**: the route file exports `GET`
and nothing else, so there is no write handler to switch off.

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
