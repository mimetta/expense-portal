# Expense Portal — Project Context

**Purpose of this file.** A standing handover document for the Mimetta expense portal: what the
system is for, what has been built, what is still open, and the rules that have been learned the
hard way. Written 2026-11-23 as a continuity record when the owner moved to a new account; the
assistant-side project memory it was assembled from does not transfer between accounts, so this
file is now the single source of that context. Keep it updated as decisions are made.

Read this alongside `CLAUDE.md`. `CLAUDE.md` holds working rules for the assistant; this file holds
the domain and history.

---

## 1. What the system is

An internal expense request and approval portal for Mimetta (formerly Coroand Co.), a Thai consumer
goods company. It replaces a legacy Google Apps Script + Google Sheets system, now frozen, with
migration complete.

Two business units: **ONEST** (manufacturing / brand) and **SV** (sales and brand).

**Owner, admin, and primary developer:** Darling (noppatsorn.k) — Business Technology lead, and the
only person working on this. There is no second developer to hand a half-finished change to.

### Objectives

- A reliable, modern internal tool with no ongoing cost.
- Handle multi-role expense workflows without silent write failures, race conditions, or manual
  workarounds. These were fundamental limits of the GAS/Sheets architecture and are the core reason
  for the migration.
- Budget vs actual visibility by department and category, owned and maintained by the people
  accountable for each budget rather than centrally.
- Serve as the system of record for spend that other internal systems read from, rather than having
  each system keep its own copy.

### Success criteria

Stable, zero-ongoing-cost, no silent failures, no race conditions, and no spreadsheet kept
alongside it "just in case".

---

## 2. Stack and locations

| | |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| Backend | Supabase — PostgreSQL, Auth, Storage |
| Auth | Google OAuth via Supabase Auth |
| Hosting | Vercel |
| Repository | `kindcollectives/expense-portal` |
| Production | https://expense-portal-sigma.vercel.app |
| Notifications | Discord webhooks + in-portal notification bell |
| Attachments | Supabase Storage — `attachments` bucket; signature PNGs in `signatures` |

Email domain migration from `@coroand.co` to `@mimetta.co` is complete.

**KinOS** is a parallel internal system for store operations, built separately, sharing the same
Supabase project and reading portal data through the external API (section 9).

### Why Supabase Storage

Chosen over Google Drive (CORS problems) and over paid storage (cost). Free tier is sufficient.

---

## 3. People and roles

| Person | Role |
|---|---|
| mitdanai.s | CEO (approver) |
| thita.s | CEO |
| ladda.t | ACCOUNTING |
| chutikarn.p | ACCOUNTING |
| wacharanan.j | BO — HR Salary, company-wide across 6 departments |
| siriwan.b | BO — COG and Factory Investment |
| chawanphat.b | BO — ONEST Marketing |
| akanit.t | BO — SV Marketing |
| wannisa.p | BO — SV R&D |
| sitanun.n | PROCUREMENT + BO — OEM |

### Role model

Seven roles: `SUPERADMIN`, `CEO`, `ACCOUNTING`, `BO`, `PROCUREMENT`, `PETTY_CASH_CUSTODIAN`,
`EMPLOYEE`. A person may hold several. `DEPT_HEAD` is retired — it used to be kept separate from BO
and no longer is.

**Procurement must not have petty cash access** — internal control concern. Corporate cards or
expedited reimbursement are the preferred alternatives.

### External collaborator

**K.Port** builds **KC-Dashboard**, an internal dashboard that consumes the portal's read-only API.
See section 9.

---

## 4. Data model essentials

### `requests` — the central table

Primary identifier is **`request_id`** (text, e.g. `EXP-2026-09-000172`). There is no `id`,
`request_no` or `request_date` column. The date column is **`"timestamp"`**, which needs quoting in
SQL because it is also a type name.

Key columns: `requester_email`, `requester_name`, `bu`, `use_for_company`, `department`,
`budget_period`, `expense_type`, `product`, `cat_l1`, `cat_l2`, `description`, `amount_net`,
`vat_rate`, `vat_amount`, `wht_rate`, `wht_amount`, `total`, `supplier_name`, `pay_method`,
`bank_name`, `pay_ref`, `due_date`, `status`, `items_json`, `items_summary`, `items_count`,
`files_json`, `po_*`, `bo_approver`, `ceo_approver`, `accounting_user`, `paid_at`, `rejected_*`,
`rejection_history`, `resubmit_count`, `chapter`, `petty_cash_*`, `travel_items`, `edit_requested_*`,
`status_before_edit`.

A request holds **line items in `items_json`**, each with its own `segment`, `cat_l1`, `cat_l2`,
`description` and `amount_net`. Header fields and item fields can and do disagree — see section 6.

### `categories`

Columns: `id` (uuid), `bu`, `department`, `product`, `cat_l1`, `cat_l2`, `active`.

**Keyed on `bu`, not `use_for_company`.** This matters — see section 6.

Categories are **per-company**. The same display name can be active in one BU and retired in the
other. For example `Marketing Influencer/KOLs` is `active = false` for ONEST (it became a `cat_l2`
under `Brand Building`) and `active = true` for SV, where it is still a `cat_l1`. So "is this
category retired?" has no company-free answer, and SV files some marketing spend one hierarchy level
higher than ONEST does.

### Budget

```sql
budget_revisions(id, owner_email, fiscal_year, revision_no, status, created_by,
  submitted_by, submitted_at, approved_by, approved_at, rejected_by, rejected_at,
  note, self_approved, ...)
  -- constraint no_self_approval, relaxed for SUPERADMIN

budget_lines(id, revision_id, bu, department, cat_l1, cat_l2, month, amount, branch)
  -- branch NOT NULL DEFAULT ''  (empty string = not branch-split)
  -- cat_l2 NOT NULL DEFAULT ''  (migration 029 — see section 6)
```

Revisions are **BO-scoped, not segment-scoped**. This was a deliberate change: `wacharanan.j` owns
HR Salary across six departments, so a segment-scoped revision could never represent one owner's
budget.

Because one segment's budget can come from several owners, the current budget resolves
**per line, not per revision**:

```sql
create or replace view v_budget_current as
  select distinct on (bu, department, cat_l1, coalesce(cat_l2,''), month) ...
  where r.status = 'APPROVED'
  order by ..., r.approved_at desc;
```

### Revenue

```sql
revenue_channels(id, bu, category, sub_category, status, channel, sort_order, active)
  -- status: sell / use / closed; NULL where the level does not apply

revenue_goals(channel_id, fiscal_year, month, amount, actual_amount,
  actual_source, actual_synced_at)
```

Four-level hierarchy: BU → category → sub-category → channel. Channels can be added mid-year.
Branches for Retail budgeting are **the same entities as revenue channels**.

Actuals sync daily from a Google Sheet via a read-only service account. Creating the key needed an
org-policy exception for `iam.disableServiceAccountKeyCreation`. **The service account JSON key must
never be pasted into a chat or into Claude Code.**

### Users & access (v2)

```sql
people(email PK, bu, bu_defaulted, visible_departments, chapter,
  is_auto_registered, active, ...)
person_roles(email, role)
bo_scopes(email, bu_scope, dept_scope, cat_l1_scope)
person_menu_overrides(email, menu, allowed)
```

One record per person holding roles, visible departments, BO ownership scope and per-menu access.
This replaced scattered `roles` rows, a separate People & departments tab, and the
`settings_tab_permissions` table. **The old `roles` and `settings_tab_permissions` tables can be
dropped** — still pending.

BO scope is keyed on **`use_for_company`** — which company the expense is charged to, not which
company the person works for. Five of ten owners hold lines in a company they do not work for.
`cat_l1` scopes are **explicitly enumerated** (verified by the `check:bo-coverage` script);
specificity-beats-wildcard was considered and rejected.

### `lib/spend.ts` — single source of truth for spend basis

```ts
export const SPEND_AMOUNT_FIELD = 'total'          // gross; 'amount_net' if budgets go pre-VAT
export const SPEND_PERIOD_FIELD = 'budget_period'
export const ACTUAL_APPROVED = ['CEO_APPROVED', 'PAID']
export const ACTUAL_PAID     = ['PAID']
export const PENDING_STATUS   = ['SUBMITTED', 'BO_APPROVED']
```

---

## 5. What is built and live

**Spend Report** (`/reports/spend`) — budget vs actual by segment; month, quarter and year views
with month columns nested inside quarter and year; heatmap tinting; two-stage drill-down to `cat_l2`;
sticky segment column; pro-rated current-month budget. Visible to BO, CEO, ACCOUNTING, SUPERADMIN.

**Budget Editor** (`/budget`) — BO-scoped revisions, 12-month grid with paste, fill-right and
arrow-key navigation, CEO approval workflow, SUPERADMIN self-approval with a visible marker,
Discord and notification-bell integration.

**Revenue goals and actuals** — goal/actual cells by channel, daily Google Sheets sync.

**Users & access** — single page per person (section 4).

**Branch-level budgeting for Retail** — branch dropdown grouped as Owned store / Specialty partners
/ Event, in a fixed sort order. `Physical store` was renamed from Modern trade to **Specialty
partners**. A branch field on New Store Investment with a **"Shared"** option covering both
departments, and a permanent branch review screen for records filed before the branch field existed.

**External read-only API** — section 9.

**Categories reconciliation** — 41 orphan combinations resolved down to a negligible remainder,
using snapshot tables and `audit_log` rows throughout.

**Infrastructure fixes** — Supabase OAuth redirect allowlist now permits preview deployments while
signed in; a 29-migration history divergence between local and remote repaired;
`migrate-from-sheets.ts` guarded by `assertNotReconciled()` so it refuses to run against a
reconciled database.

### Heat bands and design tokens

DM Sans with `tabular-nums` (DM Mono removed). Forest `#1F3A2B` primary, burnt terracotta `#BD5A2E`
accent, warm cream `#FAF8F4` page background, sandstone `#D8CBB0` borders. Minimal modern SaaS
aesthetic, closest reference the Supabase dashboard.

Heat bands: `< 80%` → `#2E7D52`, `80–100%` → `#C99A2E`, `> 100%` → `#B23A2F`.

---

## 6. Structural rules and known traps

These are the things that have actually broken. Read before touching categories, budgets or
migrations.

### A passing build is not evidence a deployment works

Recorded in `CLAUDE.md`. Verification means checking deployed behaviour. Reading code and reporting
what it *should* do has produced wrong conclusions more than once — including a report that users
were seeing an all-zeros P&L when `/budget` was actually returning 404 because `app/budget/` was
never committed.

### `''` and `NULL` are different states and must stay different

`cat_l2 = ''` means "a category was expected and left blank". `cat_l2 IS NULL` means "this level
does not apply". Collapsing them with `nullif()` or `coalesce()` merges two genuinely different
states — and on at least one occasion two groups with *different* intended destinations.

Never normalise them in matching logic for a migration. Use `IS NULL` and `= ''` as separate
predicates, and assert the per-group counts before writing.

### `budget_lines.cat_l2` is deliberately `NOT NULL DEFAULT ''`

Migration 029. A nullable column cannot arbitrate `ON CONFLICT`, and `NULL <> NULL` would let
duplicate "no cat_l2" lines through. 152 rows depend on this.

**A blanket "never empty string" rule across the database would break the budget upsert.** Any
`CHECK` constraint for blank categories must be on `requests` only. The two tables genuinely
disagree about how to spell "no cat_l2", and that disagreement is why `v_request_spend` reaches for
`nullif` in the first place.

### `v_request_spend` makes blank categories invisible

Migration 065, roughly lines 74–76:

```sql
coalesce(nullif(e.item ->> 'department', ''), r.department) as department,
coalesce(nullif(e.item ->> 'cat_l1',     ''), r.cat_l1)     as cat_l1,
coalesce(nullif(e.item ->> 'cat_l2',     ''), r.cat_l2)     as cat_l2,
```

A line item with a blank category **inherits its request header's category**. Consequences:

- A blank item only *appears* blank when its header is also blank. Where the header has a real
  category, the blank line hides beneath it and the spend report quietly attributes that money to
  the header's category.
- **159 item-level blanks company-wide are currently charged to their header's category.** This is
  not a Marketing problem; ONEST Retail alone is three times the size of Marketing.
- Two lines were reported as Marketing requests with categories that were stored nowhere — they
  were R&D requests whose blank Marketing-segment items had inherited the R&D header's `cat_l2`.

Department also comes from the item's `segment`, not from `requests.department`, so a request's
department and its items' segments can differ. That is arguably correct — one request can hold
lines in different segments — but it means a report keyed on one will not reconcile with a report
keyed on the other.

**Sequence for fixing this:** write paths first, then clean the existing blanks, then remove the
inheritance from the view. Removing the inheritance first would light up the report with
uncategorised lines before there is any way to fix them.

### The category dropdown may be keyed on the wrong company

`categories` is keyed on `bu`. Spend, budgets and BO scope are keyed on `use_for_company`. The
submit form appears to offer the **requester's own BU's** category list while the expense is charged
to a different company — producing categories that are valid for the person filing and orphaned
against the company being charged.

Evidence: `jaranya.s` filed three requests within 27 minutes on 2026-02-18, two charged to ONEST and
one to SV, all three using `Brand Material & Packaging Design`, which exists in `categories` only
for `bu = SV`. `CRM` is the same shape. Neither has an ONEST row at all — not even an inactive one.

**This is unconfirmed and worth confirming early**, because a category with no row for the company
being charged is worse than a blank one: it lands outside every budget silently. Sizing query:

```sql
select r.use_for_company, r.bu, r.department, count(*) as requests
from requests r
where not exists (
  select 1 from categories c
  where c.bu = r.use_for_company
    and c.department = r.department
    and c.cat_l1 = r.cat_l1
    and coalesce(c.cat_l2, '') = coalesce(r.cat_l2, '')
)
group by 1, 2, 3
order by requests desc;
```

### Rejected and expired requests stay frozen

Standing rule, set deliberately and not a one-off. Rejected requests are **never** recategorised
during data cleanups, even where doing so would move no total. The same applies to `EXPIRED`, which
cannot be revived or approved later.

### Capitalisation and spelling are a recurring bug class

Pairs that have each caused a real bug: `Brand Building` / `Brand building`,
`Tiktok Ads` / `TikTok Ads`, `Unusual&Friends` / `Unusual & Friend`,
`Revenue & Conversion`. Two destination names were also *invented* in a brief and did not exist:
`CRM Promotion support (loyalty)` (real value: `CRM Promotion support`, len 21) and
`PR / Media` (real value: `PR / Media Exposure / Gifting`, len 29).

**Before any migration writes a category name, verify the exact stored string** with `length()` and
ideally hex. Match on one candidate or refuse — never create a category to make a migration fit, and
never guess a spelling.

The same split is already live in `bank_name` — see section 8.

### `audit_log` is never rewritten

Request data *is* rewritten, with a snapshot plus audit rows. `audit_log` itself is append-only.

### PostgREST caps result sets at 1000 rows

A `fetchAllRows` helper exists to page past it. Any new query over a large table needs it.

### One-off scripts outlive their safety

Three scripts would have silently reverted completed work if re-run: `fix-category-departments.ts`
(would have reversed migration 020), `migrate-from-sheets.ts` (now guarded by
`assertNotReconciled()`), and `backfill:access-v2` (would have reverted role changes). Guard or
delete one-off scripts once they have run.

### Terminology

"Segment" is the **UI label only**. Every database column and variable uses **`department`**.
"Factory" was a mislabelled department and is remapped to **COG**.

Budget is entered manually in the portal. There is no budget spreadsheet.

Both companies have distinct PDF headers: ONEST → Mimetta Co., Ltd., Bangkok; SV → S.V. Agriculture
Co., Ltd., Ratchaburi.

---

## 7. The migration pattern

Established at migration 043 and used through 068. Every schema or data migration touching request
data follows it:

1. **Snapshot** the affected rows into a `_bk_<nnn>_<name>` table, full rows including `items_json`.
   Keep the table; do not drop it.
2. **Rewrite both places a category lives** — the request header fields *and* the matching element
   inside `items_json`. Preserve `items_json` ordinality byte-identically apart from the fields being
   changed. Non-matching items in the same request must come through unchanged.
3. **One `audit_log` row per request**, recording the old and new values with `''` and `NULL`
   distinguishable, plus the migration number. Never rewrite an existing audit row.
4. **Verify-or-abort inside the transaction**, measured against the same live data in the same run.
   Assert FY totals per company and in total, affected department totals, that out-of-scope rows are
   untouched, that frozen rows are byte-identical, and that destination counts moved by exactly the
   expected amounts. Any failure rolls back the whole thing. No partial commits.
5. **State the rollback SQL** in the migration header comment.

### Never verify against a figure read earlier

FY2026 approved-basis ONEST read 858 / ฿9,932,551.21 on 2 Nov, 863 / ฿10,027,638.71 on 3 Nov
morning, and 865 by that afternoon — requests get approved while you work. Every before/after
comparison must be measured inside the same run as the write.

**Known gap in how this is invoked:** `supabase db push` only surfaces output on failure, so
`RAISE NOTICE` lines carrying the before/after figures go nowhere on success. Assertions written as
`RAISE NOTICE` print and do **not** block. "The commit is the proof" only holds if every comparison
is a `RAISE EXCEPTION`. **Migration 068's assertions have not been confirmed to be exceptions rather
than notices** — worth reading that file and checking.

### Migration history

Remote once tracked 001/002/016 while 004–015 were applied but unrecorded. Repaired with
`supabase migration repair --status applied`; `db push` is then a no-op verification.

---

## 8. Open items

### Needs a decision or a person

- **Possible duplicate payment, ฿4,643.80.** Four requests at exactly ฿4,340.00 net / ฿303.80 VAT /
  ฿4,643.80 gross, across four consecutive months, **two of them PAID**:

  | request | date | requester | filed as | status |
  |---|---|---|---|---|
  | `EXP-2026-06-000101` | 17 Jun | chawanphat.b | `CRM` / — | EXPIRED |
  | `EXP-2026-07-000123` | 21 Jul | pinprai.t | `CRM & Retention` / `CRM Promotion support` | **PAID** |
  | `EXP-2026-08-000080` | 11 Aug | pinprai.t | `Direct Material - COG` / `Raw Materials` | REJECTED |
  | `EXP-2026-09-000030` | 4 Sep | chawanphat.b | `CRM & Retention` / `CRM Promotion support` | **PAID** |

  Either four monthly brochure runs that cost the same every time, or one invoice paid twice. The
  identical VAT to the satang argues for the latter. Unresolved — needs `supplier_name` and
  `pay_ref` compared between July and September, and Accounting (Ice or Ying) if they match.
  **K.Port's filed Q3 figure comes from the portal, so if this is a duplicate his Q3 drops by
  ฿4,643.80.** He has been warned to hold off re-filing Q3.

  The August row is also the clearest evidence for the form bug: the same person filed July
  correctly and then filed the same amount under a COG category three weeks later.

- **฿1,585 orphan, `EXP-2026-06-000043`.** ONEST / General Administrative, PAID,
  `ค่าเดินทางไปAmpack`, filed as `People & HR & System` / `BB ค่าเดินทาง` — **neither string exists
  anywhere in `categories`**, for either BU, and there is no General Administrative travel category
  at all. The existing convention is clear from the rest (`MKT ค่าเดินทาง`, `RD ค่าเดินทาง`,
  `HR ค่าเดินทาง (ส่วนกลาง)`), so `Supporting Budget / BB ค่าเดินทาง` for ONEST General
  Administrative is the obvious shape — but it means **creating** a category, which is the owner's
  decision. This is the same ฿1,585 deferred row left over from the ฿6.56M reconciliation.

  Travel categories that do exist: `HR Operation / HR ค่าเดินทาง (ส่วนกลาง)` (both BUs, People
  (HR)); `RD Other expenses / RD ค่าเดินทาง` (both BUs, R&D); `Supporting Budget / MKT ค่าเดินทาง`
  and `MKT ค่าที่พัก` (both BUs, Marketing); `Supporting Budget / ค่าส่ง (Grab/Lalamove)` (ONEST,
  Retail).

- **No budget has been approved yet.** Ten BOs have never opened the editor. The feature is built
  and live but unused, which means it is also untested by anyone but the owner.

### Blank-category cleanup

Two halves, and only the first is safe to run now.

**2a — stop the bleeding.** Pure code, no category decisions. Normalise `''` → `NULL` at every write
path, then a `CHECK` on `requests` only.

The four sources found:

1. `components/shared/RequestForm.tsx` — the item template seeds `cat_l1: ""`, `cat_l2: ""`.
   Changing segment or department **resets both**.
2. Validation requires `cat_l1` but **not** `cat_l2`, so a blank `cat_l2` posts verbatim into
   `items_json`. This is the main source and explains why item-level blanks (159) outnumber header
   blanks (85).
3. The header is normalised **inconsistently**: `RequestForm.tsx:919-920` uses
   `items[0]?.cat_l1 || undefined`, which catches `''`; `lib/resubmit.ts:67,84` uses `??`, which
   passes `''` straight through, so owner-edit and edit-resubmit can write a blank header. An API
   route around line 242 also uses `?? null`.
4. `app/api/categories/route.ts` is correct. The `categories` table holds zero blank strings.

`requests.cat_l1 = ''` is zero rows, so that half of the constraint validates immediately.
`cat_l2 = ''` has 85 header rows, so it needs cleanup first or `NOT VALID`. The 159 item-level
blanks live inside JSONB where a `CHECK` cannot reach — those need the write-path fix plus a
trigger. Headers also are not consistently populated from `items[0]` (three of the four ฿4,340 rows
have a null header `description` while their items have one), which belongs in the same audit.

**2b — clean the existing 244.** 107 requests, and every group needs a category decision. By
department: ONEST Retail 46 requests, Operations/Fulfillment 16, COG 14, Factory Investment 8,
Marketing 7 (now done), R&D 6, People (HR) 2, New Store Investment 1; SV Operations/Fulfillment 4,
People (HR) 2, COG 1. Do not start until 2a has landed, or it refills behind you.

Worth building alongside: **an uncategorised report that reads stored values rather than
`v_request_spend`**, or 2b's progress will be invisible because of the inheritance described in
section 6.

### `bank_name` spelling split

Seven banks each split across two spellings, ~1,233 records. Banks are a **hardcoded array in
`lib/constants.ts`** around line 216 — there is no banks table, so adding one is a file edit plus a
deploy.

| | bare | with code |
|---|---|---|
| ไทยพาณิชย์ | 230 | `ไทยพาณิชย์ (SCB)` 322 |
| กสิกรไทย | 201 | `กสิกรไทย (KBank)` 201 |
| กรุงไทย | 81 | `กรุงไทย (KTB)` 65 |
| กรุงเทพ | 23 | `ธนาคารกรุงเทพ (BBL)` 34 |
| กรุงศรีอยุธยา | 8 | `กรุงศรีอยุธยา (BAY)` 8 |
| UOB | 41 | `ยูโอบี (UOB)` 1 |

Two non-obvious points: `ทหารไทยธนชาต` (5) and `ทีทีบี (TTB)` (13) are **the same bank**
(TMBThanachart), and the exact-tie counts (201/201, 8/8) say the dropdown's convention changed at a
specific point rather than people typing freely. Also `อื่นๆ` (28) as a catch-all, and
`China Bank` (4) / `India Bank` (2) which look free-typed or legacy-imported.

Lower stakes than categories — `bank_name` is not used in any budget — but it breaks any payment
report grouped by bank. `CITI` was added 2026-11-12; it had no prior variant.

### Smaller open items

- `thitiporn.j`'s Settings page is empty despite holding Products and Suppliers as overrides.
- `edit_requested_at` and the other `edit_*` columns **now exist**, so Request Edit may be fixed —
  it was listed as broken because that column was missing. Needs testing rather than fixing.
- 14 SV Marketing travel requests share the pattern migration 067 fixed for ONEST and were
  deliberately left. SV Marketing categories are half-migrated.
- SV revenue has no source feed.
- The Google Sheet returns `""` rather than `0.00` for unposted cells. The portal side handles this;
  the sheet side is still the owner's to change.
- Goodhood confirmation with Panchita; LOQA event dates.
- Drop the old `roles` and `settings_tab_permissions` tables.

---

## 9. External API

`lib/external-api.ts#API_KEYS` declares label, environment variable and scope together:

| label | env var | may read |
|---|---|---|
| `kc-dashboard` | `KC_DASHBOARD_API_KEY` | all channels |
| `store-ops` | `STORE_OPS_API_KEY` | `Physical store` only |

- Auth is a static key in the **`x-api-key`** header. Sending the key under the *env var name* as the
  header produced a long and confusing 401 debugging session — if a consumer reports 401, check the
  header name first.
- Constant-time compare without short-circuit. Rate limit 60 requests/minute.
- `*_API_KEY_PREVIOUS` supports a rotation overlap window.
- **API keys are set in Vercel by the owner only.** Never generate, print or commit one.
- Keys go to consumers directly, not in a group chat.
- **The API must never expose budget or spend to KC-Dashboard**, which is open to anyone in the
  company with dashboard access. Revenue only.
- `kc-dashboard-api-guide.md` documents the contract, corrected against a live response: `null ≠ 0`,
  the current month is partial, Event channels trade in short bursts so nulls are normal,
  `scope.complete`, and that there is no rotation overlap window.

### Marketing-spend endpoint — agreed with K.Port, not yet built

Replaces the **Onest Cashflow app** (`onest-cashflow.vercel.app`) entirely. The dashboard reads that
app for exactly one thing — the non-platform marketing lines behind Marketing efficiency on `/ads`,
and the same figure on Overview, Margin and Signals. Nothing else on the CEO view comes from it.
The app gets switched off in the same change. Ying's cash-flow spreadsheet is unrelated and the
dashboard has never read it.

Agreed requirements:

- **Scope rule: ALL ONEST Marketing categories EXCEPT HR Salary.** Written deliberately as an
  exclusion, not a whitelist — both HR Salary lines are ฿0 today, so a whitelist would look
  identical right up until it wasn't.
- **No fixed line list.** Every line under Marketing, each with a **stable code that survives a
  display-name rename**, plus a **fixed `is_platform_ads` flag** (Instagram/Meta, Shopee, Lazada,
  TikTok). The dashboard excludes platform ads **by flag, not by name**, because it takes those from
  its own Ads tab.
- **Close fields, in this order:** ship `settled_through` first, shown as information and not graded;
  then the real month close marked by Accounting, which becomes K.Mhee's monthly close. The dashboard
  grades a month only once Accounting has closed it.
- `generated_at` — agreed as specified.
- Backfill approved. K.Port needs the month list and rough completion dates, because **his filed Q3
  comes from the portal**.

### Stable category codes — design decided, not built

Chosen approach, staged:

**Now:** a `code` column on `categories` — immutable, enforced by a trigger that rejects any
`UPDATE` to it. Human-readable at creation (`MKT-BB-EVENT-OFFLINE`) and never edited afterwards, or
it defeats the purpose. Plus the `is_platform_ads` boolean. Rename becomes a **transactional
operation**: changing a display name rewrites the text references in `requests`, `budget_lines` and
`items_json` in the same transaction with snapshot, audit and verify. Migration 067 already proved
that pattern on exactly this problem; this makes it a function rather than a one-off.

**Later, not now:** migrating `requests` and `budget_lines` to reference the code instead of the
name. That is the correct end state but it touches every spend row, every budget line and every
JSONB blob.

**Why not the cheap options.** `requests.cat_l1` / `cat_l2` and `items_json` store the category as
*text*, so any code resolved by joining on the name inherits the name's fragility: the moment someone
renames a category, the request rows still carry the old name, the join stops matching, and the
"stable" code silently goes null or wrong. Exposing the existing uuid primary key, or synthesising
codes in the API layer, both have this flaw.

**The code is per `(bu, department, cat_l1, cat_l2)` row, not per name.** The same display name can
be a live `cat_l1` in SV and a retired one in ONEST, as two separate rows with different uuids.
Consumers must not treat a code as globally unique to a display name.

---

## 10. Recent migrations

**067** — reconciled `Supporting Budget / ค่าเดินทาง` → `Supporting Budget / MKT ค่าเดินทาง`.
17 requests, ฿10,714 on the approved basis; all FY2026 totals identical before and after. 14 SV
Marketing requests with the same pattern deliberately untouched.

**068** — ONEST Marketing category mapping. Applied, 27 lines across 15 requests. Snapshot
`_bk_068_marketing_uncat` retained.

| group | from | to | lines |
|---|---|---|---|
| A | `Brand Building` / `NULL` | `Brand Building` / `Event (Offline Campaign)` | 7 |
| B | `Brand Building` / `''` (header also blank) | `Supporting Budget` / `MKT ค่าเดินทาง` | 15 in 3 requests |
| C | `CRM & Retention` / `''` | `CRM & Retention` / `CRM Promotion support` | 1 |
| D | `Supporting Budget` / `NULL` | `Supporting Budget` / `MKT ค่าเดินทาง` | 1 |
| E | `Supporting Budget` / `''` | `Brand Building` / `Sponsor (brand)` | 1 |
| F | `EXP-2026-09-000172` item#5 | `Brand Building` / `Marketing Influencer / KOL` | 1 |
| G | `EXP-2026-10-000078` item#1 | `Brand Building` / `PR / Media Exposure / Gifting` | 1 |

Groups D and E are both `Supporting Budget` and differ only by `NULL` vs `''`, with different
destinations — the case that makes the no-`nullif` rule concrete. F and G were single-row fixes
matched by request id and item ordinal on **R&D** requests carrying Marketing-segment items; F's
defect was a `cat_l1` value that belonged in `cat_l2`, left behind when
`Marketing Influencer/KOLs` moved down a level in ONEST and changed spelling to
`Marketing Influencer / KOL` in the process.

One line was deliberately **not** touched: group A's 8th, a REJECTED request at ฿60,000, under the
frozen rule.

Retired-`cat_l1` survey, read-only: four values, five lines, ฿6,751 total across the whole database
(`CRM` ฿4,340, `People & HR & System` ฿1,585, `Brand Material & Packaging Design` ฿732 over two
lines, `Marketing Influencer/KOLs` ฿94). All but the ฿1,585 are now frozen or fixed.

---

## 11. How the work runs

The owner runs Claude Code in their own terminal and pastes prompts into it. The assistant does not
have repository or database access.

Established cycle: **mockup first → approval → prompt → review the result → iterate.** Mockups are
produced as standalone HTML before any implementation prompt is written, and design problems are
caught consistently at that stage rather than after a build.

Working preferences:

- Edits should be **surgical and minimal** — targeted patches, not full-file rewrites.
- Step-by-step terminal instructions when shell commands are involved, including the `mv` and
  `git add` steps for any file that needs to reach the repo. A downloaded mockup that was never moved
  has broken a prompt more than once.
- Deployments get tested immediately after each change, with specific error messages and visual
  symptoms reported back.
- Requirements come in a mix of English and Thai, directly and concisely.
- Match the register to the task. A one-line question wants a one-line answer; migration work earns
  the full verification treatment. Applying migration-grade caution to a trivial change is its own
  failure.

### Security constraints, standing

- API keys and the Google service account JSON key are set by the owner. Never generate, print,
  commit, or ask for them in chat.
- CSV files are gitignored (`*.csv`) as raw financial data. Do not commit them and do not copy their
  contents into committed files.
- The external API exposes revenue only, never budget or spend.
