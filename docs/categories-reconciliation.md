# Categories reconciliation plan — 41 orphan combinations

**Status: proposal for review. Nothing here has been applied.** No migration, no writes to
`categories` or `requests`, no role changes.

Snapshot taken 2026-08-25 against the live database. Figures move: `SV / Retail / Utilities`
grew from 21 lines / ฿20,158 to 27 lines / ฿23,147 in the six days since the previous count,
because that combination is still accruing spend. Re-run before acting on exact numbers.

An *orphan* is a `(bu, department, cat_l1)` combination carrying FY2026 spend that has no
matching row in `categories`, so the budget editor would have no line to budget it against.

## Decisions taken as given

- `Factory` is not a real department; requests carrying it are mislabelled and belong under
  `COG`. `Factory` is to be removed from `lib/constants.ts#DEPARTMENTS`.
- Categories stay duplicated per BU. No `bu='*'` rows; missing BU pairs get created.
- `v_request_spend` will group by the item's `segment` rather than the header `department`
  (built separately — assumed here, not designed here).

## The plan

| # | bu | department | cat_l1 | lines | FY26 spend | action | target | rationale |
|---|---|---|---|---|---|---|---|---|
| 1 | SV | Factory | Raw Materials | 98 | ฿2,021,573 | `REMAP_DEPT + ADD_CATEGORY` | dept → COG; create (SV, COG, Raw Materials) | Factory is not a real department. `Raw Materials` does not exist under COG for SV, so the remap alone would leave the spend with no line. Canonical in CATEGORY_NAME_MAP. |
| 2 | ONEST | Factory | Direct Material - COG | 57 | ฿1,549,999 | `REMAP_DEPT` | dept → COG | `Direct Material - COG` already exists under (ONEST, COG). Remap only. |
| 3 | SV | Factory | Direct Material - COG | 39 | ฿753,768 | `REMAP_DEPT` | dept → COG | Already exists under (SV, COG). Remap only. |
| 4 | ONEST | Marketing | Marketing Influencer/KOLs | 7 | ฿401,694 | `ADD_BU_PAIR` | create (ONEST, Marketing, Marketing Influencer/KOLs) | Exists as (SV, Marketing, …). Department is correct; only the ONEST pair is missing. |
| 5 | SV | Factory | Factory Operation (OH) - COG | 46 | ฿339,325 | `REMAP_DEPT` | dept → COG | Already exists under (SV, COG). Remap only. |
| 6 | SV | General Administrative | EMPLOYEE BENEFITS & WELFARE (Company-Wide) | 11 | ฿290,500 | `ADD_CATEGORY` | create (SV, General Administrative, EMPLOYEE BENEFITS & WELFARE (Company-Wide)) | Self-mapping canonical target in CATEGORY_NAME_MAP — this IS the canonical spelling, not a duplicate. Simply absent from `categories`. |
| 7 | ONEST | Factory | Raw Materials | 12 | ฿217,512 | `REMAP_DEPT + ADD_CATEGORY` | dept → COG; create (ONEST, COG, Raw Materials) | Same as the SV row: absent under COG, needs both. |
| 8 | SV | General Administrative | HR Operation | 49 | ฿130,427 | `REMAP_DEPT` | dept → People (HR) | `HR Operation` exists only under People (HR), in both BUs. Legacy GA mislabel. |
| 9 | ONEST | Factory | Factory Operation (OH) - COG | 10 | ฿113,453 | `REMAP_DEPT` | dept → COG | Already exists under (ONEST, COG). Remap only. |
| 10 | SV | New Store Investment | Store Design & Construction | 2 | ฿98,600 | `ADD_BU_PAIR` | create (SV, New Store Investment, Store Design & Construction) | Exists for ONEST only. |
| 11 | SV | General Administrative | Software & Tools | 11 | ฿86,811 | `ADD_CATEGORY` | create (SV, General Administrative, Software & Tools) | ⚠ DEVIATES from the default rule. `Software & Tools` lives under Operations/Fulfillment, but GA buying software is normal, and this schema already uses per-department software categories (`MKT Software & Tools`, `HR Operation - Software & Tools`). Remapping GA software spend into OPF would misattribute it. Flagged for your call. |
| 12 | ONEST | Factory | Factory Consumable | 17 | ฿77,317 | `REMAP_DEPT + ADD_CATEGORY` | dept → COG; create (ONEST, COG, Factory Consumable) | Absent under COG. Canonical in CATEGORY_NAME_MAP. |
| 13 | ONEST | Factory | NPD | 4 | ฿71,073 | `REMAP_DEPT + ADD_CATEGORY` | dept → COG; create (ONEST, COG, NPD) | `NPD` exists under Merchandise and OEM but not COG, so the remap needs a new COG line. |
| 14 | ONEST | Marketing | Content Production | 8 | ฿63,983 | `ADD_BU_PAIR` | create (ONEST, Marketing, Content Production) | Exists for SV only. |
| 15 | ONEST | General Administrative | HR Operation | 10 | ฿46,004 | `REMAP_DEPT` | dept → People (HR) | Same legacy GA mislabel as the SV row. |
| 16 | SV | Retail | Store Fixed cost | 1 | ฿44,004 | `ADD_BU_PAIR` | create (SV, Retail, Store Fixed cost) | Exists for ONEST only. |
| 17 | ONEST | Factory | (null) | 5 | ฿41,931 | `REMAP_DEPT + MANUAL` | dept → COG; cat_l1 undecided | Department is definitely wrong and remaps to COG, but cat_l1 is null — no category may be invented for it. Needs a human to classify 5 lines. |
| 18 | SV | General Administrative | People & HR & System | 8 | ฿36,457 | `MANUAL` | decide: this is a DEPARTMENT name in the cat_l1 field | ⚠ CORRECTS THE BRIEF. `People & HR & System` is a target in DEPARTMENT_NAME_MAP, not CATEGORY_NAME_MAP — it is not a category at all, and `DEPARTMENTS` uses `People (HR)` instead. Asking: should these 8 lines become department=People (HR) with a real cat_l1 (which one?), or is `People & HR & System` intended as a genuine GA category? |
| 19 | SV | Factory | (null) | 4 | ฿34,967 | `REMAP_DEPT + MANUAL` | dept → COG; cat_l1 undecided | As the ONEST null-Factory row. 4 lines to classify. |
| 20 | ONEST | General Administrative | Software & Tools | 2 | ฿33,854 | `ADD_CATEGORY` | create (ONEST, General Administrative, Software & Tools) | Same deviation and reasoning as the SV row above. |
| 21 | SV | Retail | Utilities | 27 | ฿23,147 | `ADD_BU_PAIR` | create (SV, Retail, Utilities) | Exists for ONEST only. Note this combination is still accruing new spend. |
| 22 | SV | Retail | Land and building Taxe | 1 | ฿14,837 | `ADD_BU_PAIR` | create (SV, Retail, Land and building Taxe) | Exists for ONEST only. The misspelling `Taxe` is present in the existing ONEST row too — duplicate it verbatim, or fix both together. |
| 23 | SV | General Administrative | Talent Benefits & Perks | 17 | ฿13,113 | `ADD_CATEGORY` | create (SV, General Administrative, Talent Benefits & Perks) | Self-mapping canonical target in CATEGORY_NAME_MAP. Distinct from EMPLOYEE BENEFITS & WELFARE, which is its own canonical entry — the two are NOT duplicates of each other. |
| 24 | SV | Factory | Factory Consumable | 5 | ฿9,894 | `REMAP_DEPT + ADD_CATEGORY` | dept → COG; create (SV, COG, Factory Consumable) | Absent under COG for SV. |
| 25 | SV | R&D | Legal & Compliance | 6 | ฿7,796 | `ADD_CATEGORY` | create (SV, R&D, Legal & Compliance) | ⚠ DEVIATES from the default rule. `Legal & Compliance` lives under GA, but R&D already has `Regulatory Compliance`, and R&D legal spend (patents, filings) plausibly belongs to R&D. Remapping to GA would move it off the R&D budget owner. Flagged for your call. |
| 26 | ONEST | Retail | HRD | 1 | ฿6,545 | `REMAP_DEPT` | dept → People (HR) | `HRD` exists only under People (HR). Retail already has `KA Training` for its own training spend, so this reads as a mislabel — but confirm if Retail-specific HRD was intended. |
| 27 | SV | Retail | In-Store Consumables & Supplies | 3 | ฿5,948 | `ADD_BU_PAIR` | create (SV, Retail, In-Store Consumables & Supplies) | Exists for ONEST only. |
| 28 | SV | Marketing | CRM & Retention | 1 | ฿4,644 | `ADD_BU_PAIR` | create (SV, Marketing, CRM & Retention) | Exists for ONEST only. |
| 29 | SV | People (HR) | (null) | 1 | ฿4,416 | `MANUAL` | cat_l1 undecided | Null cat_l1 in a valid department. 1 line to classify; no category invented. |
| 30 | ONEST | COG | Factory Operation (OH - COG | 2 | ฿4,054 | `MANUAL` | correct requests.cat_l1 → `Factory Operation (OH) - COG` | Unbalanced parenthesis — a typo, not a missing category. The correct spelling already exists under (ONEST, COG). This is a value fix on 2 requests, NOT an ADD_CATEGORY; adding the malformed string would enshrine the typo. |
| 31 | SV | Factory Investment | Production Equipment | 1 | ฿2,930 | `ADD_BU_PAIR` | create (SV, Factory Investment, Production Equipment) | Exists for ONEST only. `categories` has zero SV Factory Investment rows at all. |
| 32 | ONEST | Marketing | E-Commerce | 2 | ฿2,849 | `ADD_BU_PAIR` | create (ONEST, Marketing, E-Commerce) | Exists for SV only. |
| 33 | SV | People (HR) | Factory Operation (OH) - COG | 1 | ฿2,590 | `REMAP_DEPT` | dept → COG | The cat_l1 is explicitly a COG line; People (HR) is the mislabel. |
| 34 | ONEST | General Administrative | People & HR & System | 2 | ฿1,710 | `MANUAL` | decide: department name in the cat_l1 field | Same as the SV row — see that entry. |
| 35 | SV | General Administrative | (null) | 1 | ฿1,675 | `MANUAL` | cat_l1 undecided | Null cat_l1 in a valid department. 1 line to classify. |
| 36 | SV | Retail | HR Salary | 2 | ฿1,317 | `ADD_BU_PAIR` | create (SV, Retail, HR Salary) | (Retail, HR Salary) already exists for ONEST, so the pairing is legitimate and only the SV row is missing — ADD_BU_PAIR rather than a remap, even though HR Salary also appears under four other departments. |
| 37 | ONEST | R&D | Brand Building | 6 | ฿1,070 | `RESOLVED_BY_VIEW` | none — excluded | Header-vs-item artifact: the request's department is R&D while the items carry segment=Marketing and cat_l1=Brand Building. Grouping v_request_spend by the item's segment makes (ONEST, Marketing, Brand Building) — which already exists. No data change. |
| 38 | ONEST | General Administrative | EMPLOYEE BENEFITS & WELFARE (Company-Wide) | 1 | ฿845 | `ADD_CATEGORY` | create (ONEST, General Administrative, EMPLOYEE BENEFITS & WELFARE (Company-Wide)) | BU pair of the SV row; canonical spelling. |
| 39 | ONEST | General Administrative | Talent Benefits & Perks | 1 | ฿709 | `ADD_CATEGORY` | create (ONEST, General Administrative, Talent Benefits & Perks) | BU pair of the SV row; canonical spelling. |
| 40 | SV | People (HR) | Logistic Staff (pick/pack/delivery) | 1 | ฿679 | `REMAP_DEPT` | dept → Operations/Fulfillment | Exists only under Operations/Fulfillment in both BUs. Same BO either way (wacharanan.j covers both). |
| 41 | SV | People (HR) | Other Miscellaneous | 1 | ฿134 | `REMAP_DEPT` | dept → General Administrative | Exists only under General Administrative in both BUs. |

## Summary by action

| action | rows | lines | FY26 spend | share of ฿6,564,154 |
|---|---|---|---|---|
| `REMAP_DEPT` | 10 | 215 | ฿2,942,924 | 44.8% |
| `REMAP_DEPT + ADD_CATEGORY` | 5 | 136 | ฿2,397,369 | 36.5% |
| `ADD_BU_PAIR` | 11 | 55 | ฿663,953 | 10.1% |
| `ADD_CATEGORY` | 7 | 49 | ฿433,628 | 6.6% |
| `REMAP_DEPT + MANUAL` | 2 | 9 | ฿76,898 | 1.2% |
| `MANUAL` | 5 | 14 | ฿48,312 | 0.7% |
| `RESOLVED_BY_VIEW` | 1 | 6 | ฿1,070 | 0.0% |
| **total** | **41** | **484** | **฿6,564,154** | 100% |

## What remains unresolved after the plan

| | rows | lines | FY26 spend |
|---|---|---|---|
| `MANUAL` (whole row undecided) | 5 | 14 | ฿48,312 |
| `REMAP_DEPT + MANUAL` (department resolved, cat_l1 still undecided) | 2 | 9 | ฿76,898 |
| **total needing a human decision** | **7** | **23** | **฿125,210** |

That is **1.9% of the ฿6,564,154**. The other 98.1% is resolved mechanically. The seven are:

1. **`People & HR & System` as a cat_l1** (2 rows, ฿38,167) — the brief asked me to treat this and
   `EMPLOYEE BENEFITS & WELFARE (Company-Wide)` as naming-convention duplicates and take the
   canonical target from `CATEGORY_NAME_MAP`. **That premise does not hold, and the two cases are
   opposites.** `People & HR & System` appears **only in `DEPARTMENT_NAME_MAP`**, as a *department*
   target — it is not in `CATEGORY_NAME_MAP` at all, so it has no canonical category form. It is a
   department name that ended up in the `cat_l1` field. `EMPLOYEE BENEFITS & WELFARE (Company-Wide)`
   is the reverse: it **is** in `CATEGORY_NAME_MAP`, mapping to itself, so it already *is* canonical
   and is simply missing from `categories` — hence `ADD_CATEGORY`, not a remap. `Talent Benefits &
   Perks` is likewise its own canonical entry, so those two are not duplicates of each other either.
2. **Four null `cat_l1` rows** (฿83,020, of which ฿76,898 is the two Factory rows whose department
   still remaps to COG). No category invented, per the rule.
3. **`Factory Operation (OH - COG`** (฿4,054) — a typo fix on 2 requests, not a category to add.

## Resolutions that would create a NEW unowned category line

Four proposed `ADD_BU_PAIR` rows would create a `categories` row that **no BO's scope matches**, so
the line would exist and be budgetable by nobody. All four are Marketing, and all four are caused by
the same thing: Marketing's two BOs are scoped per-BU with *different, non-overlapping* `cat_l1`
lists, so a category present in one BU has no owner in the other.

| would-be new row | why unowned |
|---|---|
| `ONEST / Marketing / Marketing Influencer/KOLs` | `chawanphat.b` owns ONEST/Marketing but their `cat_l1_scope` does not list it |
| `ONEST / Marketing / Content Production` | same |
| `ONEST / Marketing / E-Commerce` | same |
| `SV / Marketing / CRM & Retention` | `akanit.t` owns SV/Marketing; their scope lists `CRM`, not `CRM & Retention` |

Creating these without also widening a scope trades 4 unbudgetable-because-missing lines for 4
unbudgetable-because-unowned lines. Recommend extending `chawanphat.b`'s `cat_l1_scope` by the three
ONEST entries and `akanit.t`'s by `CRM & Retention`, in the same change — **not done here**, and it
touches `cat_l1_scope` values, which earlier instructions put out of bounds pending the HR Salary
overlap decision.

Every other target lands on a row an existing BO already covers. No `REMAP_DEPT` target is unowned.
Separately, `SV / People (HR) / (null)` (`MANUAL`) has no owner today and would not gain one.

## Does remapping `requests.department` destroy information?

**Yes. Unrecoverably, as things stand.**

`requests` has no column holding an original or as-submitted department — no `department_original`,
no `source_*`, nothing. `UPDATE requests SET department = 'COG' WHERE department = 'Factory'`
overwrites in place, and afterwards nothing in the database records that those rows ever said
`Factory`. `created_at` cannot even be used to infer it, and once `Factory` is removed from
`lib/constants.ts#DEPARTMENTS` the value becomes unreproducible from code as well.

Scale of the loss:

| | requests |
|---|---|
| `department = 'Factory'` | **307** (295 PAID, 8 REJECTED, 2 EXPIRED, 2 CEO_APPROVED) |
| `General Administrative → People (HR)` (HR Operation) | 59 |
| `Retail → People (HR)` (HRD) | 1 |
| **distinct requests overwritten** | **367 of 1,031 (36%)** |

Plus **307 item rows carry `segment = 'Factory'`** inside `items_json`. Once `v_request_spend`
groups by the item segment, those need the same remap or the orphans simply reappear at item level.

### Proposal: preserve it, in two layers

**1. An `audit_log` row per changed request — the primary record.** The table already exists
(`id, ts, actor_email, request_id, action, detail_json`), every other mutation in this app already
writes to it, and `request_id` is a real FK. No schema change:

```
action      = 'DEPARTMENT_REMAPPED'
detail_json = { "from": "Factory", "to": "COG", "field": "department",
                "reason": "Factory is not a real department (categories reconciliation)",
                "migration": "0NN_categories_reconciliation" }
```

This makes the change explainable months later from inside the app, and it is the convention the
codebase already follows.

**2. A one-off snapshot table — for reversibility.** `audit_log.detail_json` is queryable but
awkward to roll back from. A flat table makes the undo one statement:

```
create table requests_department_remap_2026_08 (
  request_id text primary key references requests (request_id),
  old_department text not null,
  new_department text not null,
  old_item_segments jsonb,          -- items_json segments before the change
  applied_at timestamptz not null default now()
);
```

Rollback becomes `UPDATE requests r SET department = s.old_department FROM
requests_department_remap_2026_08 s WHERE r.request_id = s.request_id`.

I would do **both**: the audit rows because that is how this app records mutations, and the snapshot
table because 367 rows of overwritten financial history — 295 of them already PAID — is not
something to make irreversible in exchange for saving one small table.

**A third option, if you would rather not overwrite at all:** add `requests.department_original text`
and populate it only for remapped rows. Simpler to query than either of the above, at the cost of a
permanently-null column on ~64% of rows. I prefer the snapshot table, since the remap is a one-time
event and does not warrant a permanent column on the hot table.

### One hazard in the remap, worth deciding before anything is written

Three of the ten `REMAP_DEPT` rows match **zero** requests on the header `cat_l1`:
`SV / People (HR) / Factory Operation (OH) - COG`, `SV / People (HR) / Logistic Staff
(pick/pack/delivery)`, and `SV / People (HR) / Other Miscellaneous`. That is because those orphans
arise from an **item's** `cat_l1` paired with the header department, not from the header's own
`cat_l1` — the same shape as the row excluded as `RESOLVED_BY_VIEW`.

For those, changing `requests.department` would move **every item on the request**, including items
that were classified correctly. They should be fixed at item level, or left for the
`v_request_spend` segment change to resolve, rather than remapped at the header. Worth re-checking
each of the three against its actual request before treating them as header remaps.
