# Outbound API — KC-Dashboard

Read-only feed of **revenue goals and actuals**. Nothing else. Versioned at
`/api/external/v1/`.

Each consumer holds its own key, and a key may be **scoped to part of the data** — see
[Keys and their scope](#keys-and-their-scope).

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

**None of that applies to this API.** A caller holding a key sees **everything that key's scope
allows, for any company and any fiscal year**. Scope is coarse and per-key (currently: all
channels, or Physical store only) — it is NOT the portal's per-person model, and there is no
per-department or per-person key. There is no per-key scope, no per-department key,
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
      "status": "sell",
      "months": [
        { "month": 1, "goal": 0, "actual": 0, "actual_source": "sheet" }
        // … 12 entries
      ],
      "goal_total": 0,
      "actual_total": 0,
      "last_actual_month": 9
    }
  ],
  "freshness": {
    "last_successful_sync_at": "2026-10-05T02:00:25Z",
    "age_hours": 0,
    "stale": false,
    "last_attempt_at": "2026-10-05T02:00:25Z",
    "last_attempt_status": "success",
    "channels_not_in_sheet": 0
  }
}
```

### `status` — the optional fourth hierarchy level

`sell` | `use` | `closed`, and **`null` where the sub-category has no status level** — Owned
store, Event, and both Online sub-categories. Null is meaningful ("this level does not apply"),
not missing data, so the field is always present.

Only *Specialty partners* uses it today. A `closed` channel keeps its historical figures and is
no longer given new ones.

### `last_actual_month`

The highest month this channel has a non-null actual for, or `null` if it has none. Provided so
every consumer does not write its own scan over `months` and get the null handling subtly
different.

⚠️ **It can include a part-complete current month.** The sync imports the current month as it
stands, so on the 5th of October a channel may report `last_actual_month: 10` on five days of
trade. Treat it as "the latest month with any figure", not "the latest complete month".

### `freshness` — how old the figures are

**`last_successful_sync_at` is the last run that actually WROTE figures**, not the last attempt. A
failed sync writes nothing, so the figures served are whatever the last success left; reporting
the attempt would let a week of failures look like a fresh feed.

| field | meaning |
|---|---|
| `last_successful_sync_at` | when figures were last written. `null` if never |
| `age_hours` | how old that is, so a cached response does not need the reader to know today's date |
| `stale` | true when the last success is over 48 hours old, or there has never been one |
| `last_attempt_at` / `last_attempt_status` | `success` \| `validation_failed` \| `error` — tells "nothing changed" apart from "the last run failed and these figures are being held" |
| `channels_not_in_sheet` | channels the portal had and the sheet did not on that run. **Their figures were left unchanged and may be older than the stamp above.** |

**If `stale` is true, or `last_attempt_status` is not `success`, say so in your UI.** The portal
shows a banner for exactly this; a downstream dashboard cannot see that banner.

### A caveat on zero that this API cannot fix for you

**`actual: null` means "not yet known" and is never `0`.** A zero would assert the business took
nothing in a month nobody has lived through. Do not coalesce it to zero downstream; a percentage
built on it would be wrong. `actual_source` is `"sheet"` (imported) or `"manual"` (typed by a
CEO/admin), or `null` when no actual exists.

**But a `0` is not proof of a zero month.** The source spreadsheet writes `0.00` into every cell
it has no figure for — there are no blank cells in it — so a partner that posts its numbers late
is indistinguishable, in the data, from one that sold nothing. `null` is used only where the
portal can prove the month is unknown: a future month, or a month where every channel *and* the
sheet total read zero.

Investigated 2026-10-05 and deliberately not "fixed": any rule like *"a zero in a month where
other channels have figures means unposted"* would silently erase a genuine zero, and genuine
zeros exist (Unusual & Friend read 0 in July and August and 6,120 in September). Fixing it
requires the sheet to distinguish the two — a blank cell, or a posted-through marker.

### Endpoints that do not exist

`/api/external/v1/budget` and `/api/external/v1/spend` return **404**. They are absent, not
disabled — see the first section for why, and do not re-add them without making that decision
again.

Any verb other than `GET` on the revenue endpoint returns **405**: the route file exports `GET`
and nothing else, so there is no write handler to switch off.

---

## Keys and their scope

Each consumer holds its **own key**, declared in `lib/external-api.ts#API_KEYS`. A key's label
and its reach are one thing, in one place — a key is never labelled in one file and scoped in
another.

| label | env var | may read |
|---|---|---|
| `kc-dashboard` | `KC_DASHBOARD_API_KEY` | **all channels** — Physical store *and* Online |
| `store-ops` | `STORE_OPS_API_KEY` | **Physical store only** — Owned store, Specialty partners, Event |

`store-ops` cannot see Online (E-commerce, DTC-Thailand) **as rows or inside any total**. The
scope is applied in the query, so a restricted key never loads a channel it may not read — there
is no filtered-out row to leak through a later edit or a totals line somebody adds without
noticing. No request parameter widens it: `company` is a parameter, scope is not — it comes from
which secret matched.

### Totals are the total of what your key can see

Every response carries both:

```jsonc
"scope":  { "channel_categories": ["Physical store"], "complete": false },
"totals": { "goal": 0, "actual": 0 }
```

`complete: false` means figures cover only the categories listed. **`totals` sums the channels
actually returned, never the company.** A scoped key is deliberately never handed a company-wide
figure it cannot break down, because the hidden channels would then be recoverable by
subtraction. An unscoped key gets `"channel_categories": "ALL", "complete": true`.

### Labelling and rate limits

Each label has its **own** 60/minute allowance, counted from `external_api_calls.key_label`, so
one consumer cannot exhaust another's. A key that does not match anything is logged under
`unauthenticated` and never against a real label — a wrong key cannot spend a genuine consumer's
quota.

Keys are compared **without short-circuiting**: every configured key is checked even after one
matches, so response timing does not reveal which key matched or how many exist.

`503` is returned only when **no** key is configured at all. One consumer's variable being unset
means that consumer cannot call; it is not an outage for the others.

---

## Rotating a key — with an overlap window

Each key accepts a second value during rotation: `<ENV_VAR>_PREVIOUS`. Both authenticate, both
log under the **same label**, so a rotating consumer's rate limit stays whole.

1. Generate a new value — e.g. `openssl rand -hex 32`. Do not commit it anywhere.
2. In Vercel, set **`<ENV_VAR>_PREVIOUS`** to the value currently live.
3. Set **`<ENV_VAR>`** to the new value.
4. Redeploy. Both keys now work.
5. Give the consumer the new key.
6. **Confirm they have moved**, from the call log — see below.
7. Remove `<ENV_VAR>_PREVIOUS` and redeploy.

Step 6 is the point of the whole arrangement. A call made with the previous value is recorded
distinguishably: its `query` column ends with `[previous-key]`.

```sql
select key_label, count(*) as still_on_old_key
  from external_api_calls
 where ts > now() - interval '24 hours'
   and query like '%[previous-key]%'
 group by key_label;
```

Zero rows for a label over a period longer than that consumer's polling interval means it has
rotated and `_PREVIOUS` is safe to remove. **Do not skip to step 7 on a guess** — an overlap
window nobody can confirm is closed is one that stays open indefinitely, which is the failure
this replaces.

Rotating without an overlap is still possible: set the new value, redeploy, and accept that the
consumer gets `401` until it is updated.

---

## Versioning

The path is `/v1/` and **every response carries `"version": "v1"`**. That value will not change
while v1 exists.

**Fields may be ADDED within v1**; existing field names, types and meanings will not change.
`status`, `last_actual_month` and `freshness` were added this way on 2026-10-05 — additive, so
`version` stayed `v1` and nothing downstream had to move.

**A breaking change ships as `/v2/` ALONGSIDE `/v1/`, not in place of it.** Both serve
simultaneously, with notice before v1 is retired, so a consumer moves on its own schedule rather
than on ours. Reasons a change counts as breaking: removing a field, renaming one, changing a
type, or changing what an existing field means — including a null becoming a zero or vice versa.

Build against the version check: a consumer that rejects anything other than its expected
`version` is doing the right thing, and this contract is what makes that safe.

## Auditing revenue edits

Separately from this API, every revenue goal and actual edit now writes an `audit_log` row —
`REVENUE_GOAL_UPDATED` / `REVENUE_ACTUAL_UPDATED` — carrying who, the channel, the year, the
month, and the before/after of each cell that actually moved. `source` distinguishes `"manual"`
from `"sheet"`. Unchanged cells are not recorded, so re-running the same import is silent rather
than logging 156 non-events.

**Revenue goals are not approved.** Unlike a budget revision — which is DRAFT → SUBMITTED →
APPROVED and only counts once a CEO approves it — a revenue goal takes effect the moment it is
saved. There is no approval step, no pending state, and nothing to wait for. If you are looking
for "when was this goal approved", the answer is that the question does not apply; "when was it
entered, and by whom" is the audit log above.

**The audit begins 2026-09-30.** It shipped that day, so an edit made before it leaves no row.
For FY2026 specifically that turns out to cost nothing — every non-zero goal was entered after it
existed — but a `revenue_goals.updated_at` is NOT a substitute: the daily sync rewrites that
column on every run, so it reports when a row was last touched, not when its goal was set.
