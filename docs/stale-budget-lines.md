# Stale budget lines — decision sheet

**Report only. Nothing here has been applied.** Edit the `Verdict` column and hand it back.

A *stale* budget line is one whose `(bu, department, cat_l1, cat_l2)` matches no **active**
`categories` row. `budget_lines` stores these as plain text with no foreign key, so a rename or
a reorganisation in Settings detaches them silently — that is how all 204 below came to exist.

Generated live against production. **Re-run before acting**, since a category edit changes the set.

## Summary

| | |
|---|---|
| stale groups | **17** |
| stale lines | **204** (of 4,368 — 4.7%) |
| **total figure entered against them** | **฿0** |
| proposed | **MERGE 7 · AMBIGUOUS 2 · RETIRE 8** |

**The single most important number is ฿0.** Every stale line carries a zero figure, in all 17
groups. Nothing anyone typed is at risk, in any direction — merging, retiring or leaving them
alone all preserve the same amount of budget, which is none. This is a tidiness and
future-correctness problem, not a data-loss one.

## What the verdicts mean

- **MERGE** — an obvious typo or truncation of a category that still exists in the same
  department. Safe: the target is unambiguous and nothing else could be meant.
- **RETIRE** — no plausible target *for this owner*. The category was genuinely reorganised
  away, and the work now lives somewhere this owner does not budget.
- **AMBIGUOUS** — a plausible target exists but merging has a real cost, so it needs a human.

## The table

| Company | Department | cat_l1 | cat_l2 | Lines | Figure | Revisions | Closest active category | Verdict | Why |
|---|---|---|---|---:|---:|---|---|---|---|
| SV | General Administrative | Legal & Compliance | `"Contracts & IP (e.g. Agreements` | 12 | ฿0 | noppatsorn.o FY2026 r1 **DRAFT** | Legal & Compliance › Contracts & IP (e.g. Agreements,NDA) | **MERGE** | Truncated at the comma inside a quoted CSV field. |
| ONEST | General Administrative | TAXES | `"ภงด 1` | 12 | ฿0 | noppatsorn.o FY2026 r1 **DRAFT** | TAXES › ภงด 1 | **MERGE** | Leading quote only — CSV truncation. Target exists, same department. |
| SV | General Administrative | TAXES | `"ภงด 1` | 12 | ฿0 | noppatsorn.o FY2026 r1 **DRAFT** | TAXES › ภงด 1 | **MERGE** | Leading quote only — CSV truncation. Target exists, same department. |
| ONEST | New Store Investment | Deposits & Legal Setup | `"Legal fees (contract review` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Deposits & Legal Setup › Legal fees (contract review permits) | **MERGE** | Truncated at the comma inside a quoted CSV field. |
| ONEST | New Store Investment | POS & Technology Setup | `"POS hardware (tablet` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | POS & Technology Setup › POS hardware (tablet, cash drawer) | **MERGE** | Truncated at the comma inside a quoted CSV field. |
| ONEST | New Store Investment | Store Design & Construction | `"Engineering` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Store Design & Construction › Engineering electrical | **MERGE** | Leading quote + truncation. Only one plausible target in this cat_l1. |
| SV | R&D | Product Dev | `Product Sample` | 12 | ฿0 | wannisa.p FY2026 r1 **DRAFT** | Product Dev › Product Sample (Benchmark) | **MERGE** | Name gained a qualifier; same cat_l1, no other candidate. |
| SV | COG | Raw Materials | *(blank)* | 12 | ฿0 | siriwan.b FY2026 r1 **DRAFT** | COG › Direct Material - COG › Raw Materials | **AMBIGUOUS** | Same case as the ONEST row below: `Raw Materials` exists only one level down, as a cat_l2 under `Direct Material - COG`, where siriwan.b already holds lines in this same revision. ฿575,521 of SV spend sits at this cat_l1. |
| ONEST | COG | Raw Materials | *(blank)* | 12 | ฿0 | siriwan.b FY2026 r1 **DRAFT** | COG › Direct Material - COG › Raw Materials | **AMBIGUOUS** | Raw Materials exists only as a cat_l2, one level down. siriwan.b ALREADY holds 24 lines at the target IN THE SAME REVISION, so a merge collides. Retiring loses nothing (฿0) but ฿1.66M of FY2026 SPEND is filed at this cat_l1 and would stay unbudgetable — see note 3. |
| ONEST | New Store Investment | Factory Investment | `New Machine` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Factory Investment › New Machine (different DEPARTMENT, owned by siriwan.b) | **RETIRE** | cat_l1 was promoted to a department. Target already has 12 lines under siriwan.b, who scopes it. panchita.t does not scope Factory Investment, so this cannot move with her. |
| ONEST | New Store Investment | Factory Investment | `Production Equipment` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Factory Investment › Production Equipment (different DEPARTMENT, owned by siriwan.b) | **RETIRE** | As above. Target already has 24 lines. |
| ONEST | New Store Investment | Factory Investment | `Building & Construction` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Factory Investment › Building & Construction (different DEPARTMENT, owned by siriwan.b) | **RETIRE** | As above. Target already has 12 lines. |
| ONEST | New Store Investment | Factory Investment | `Logistic & Warehouse` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Factory Investment › Logistic & Warehouse (different DEPARTMENT, owned by siriwan.b) | **RETIRE** | As above. Target already has 12 lines. |
| ONEST | New Store Investment | Lab Instrument Investment (RD) | `Equipment for Sample Preparation & Cultivation` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Lab Instrument Investment › Equipment for Sample Preparation & Cultivation (different DEPARTMENT, owned by kojchaphorn.s) | **RETIRE** | cat_l1 promoted to a department and the “(RD)” suffix dropped. Target has 12 lines under kojchaphorn.s, who scopes it. |
| ONEST | New Store Investment | Lab Instrument Investment (RD) | `Measurement & Analysis Instruments` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Lab Instrument Investment › Measurement & Analysis Instruments (different DEPARTMENT, owned by kojchaphorn.s) | **RETIRE** | As above. |
| ONEST | New Store Investment | Lab Instrument Investment (RD) | `Small Equipment/Tools` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Lab Instrument Investment › Small Equipment/Tools (different DEPARTMENT, owned by kojchaphorn.s) | **RETIRE** | As above. |
| ONEST | New Store Investment | Lab Instrument Investment (RD) | `Weighing Instruments` | 12 | ฿0 | panchita.t FY2026 r1 **DRAFT** | Lab Instrument Investment › Weighing Instruments (different DEPARTMENT, owned by kojchaphorn.s) | **RETIRE** | As above. |
## Notes on the three groups that are not simple

**1. All 7 MERGEs are the same bug.** `categories` was bulk-imported from a CSV with a
comma-split parser that does not honour quoted fields (documented in CLAUDE.md under Settings &
Reference Data). A value like `"ภงด 1, ภงด 3"` was split at the comma, leaving `"ภงด 1` with a
literal leading double-quote. `categories` has since been cleaned; the budget lines were not,
because a draft's dimensions are frozen at creation. The clean target exists in every case.

**2. The 8 RETIREs are one reorganisation, not eight.** `Factory Investment` and
`Lab Instrument Investment` used to be `cat_l1` values under `New Store Investment`. Both were
promoted to departments in their own right, keeping their sub-categories as `cat_l1`s. The stale
lines all belong to **panchita.t**, whose scope is ONEST / Retail + New Store Investment.

They are marked RETIRE rather than MERGE because the targets are **not hers**:

| target department | already has | owned and scoped by |
|---|---|---|
| Factory Investment | 12–24 lines per category | **siriwan.b** |
| Lab Instrument Investment | 12 lines per category | **kojchaphorn.s** |

Moving panchita.t's lines there would put lines in her revision for departments she does not
scope — `assertNoScopeOverlap` would reject it at approval, and it would double-count against
owners who already budget them. The work moved; her lines should simply go.

**3. The 2 AMBIGUOUS ones are the only real decision.** `COG › Raw Materials` with a blank
`cat_l2` does have a plausible target — `Raw Materials` exists, but one level down, as a
`cat_l2` under `COG › Direct Material - COG`. Two facts pull in opposite directions:

- **Against merging:** siriwan.b already holds 24 lines at the target **in the same revision**,
  so a merge collides rather than fills a gap.
- **Against retiring:** `ONEST / COG / Raw Materials` carries **฿1,663,564** and
  `SV / COG / Raw Materials` **฿575,521** of FY2026 *spend* — filed by requesters against a
  `cat_l1` that `categories` does not have. Retiring the budget line leaves ฿2.24M of real spend
  permanently unbudgetable and showing "no budget set" in the spend report.

Retiring the stale line does not fix that; neither does merging it. The actual fix is a
**separate decision about the spend**: either add `Raw Materials` as a real `cat_l1` under COG
in Settings, or recategorise those requests to `Direct Material - COG › Raw Materials`. Both are
out of scope here and neither is mine to pick.

## What applying this would involve

Nothing is applied by this document. For the record, were it approved:

- **MERGE** is `update budget_lines set cat_l2 = <target> where …` — same department, no
  ownership change, and the existing atomic `rename_category` function (migration 042) does not
  apply because these are lines, not category rows.
- **RETIRE** is `delete from budget_lines where …`. Safe only because the figure is ฿0; it
  should re-check that at execution time rather than trusting this snapshot.
- Both should write an `audit_log` row, and neither should touch a **SUBMITTED** or **APPROVED**
  revision without saying so explicitly — check the Revisions column before acting.
