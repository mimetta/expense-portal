# Retail branch names: spend vs the revenue channel list

**Report only — nothing has been changed.** This is a decision table for you to edit.

Retail spend records a branch in `requests.product` (header) and `items_json[].product`
(per line, for Retail petty cash). The budget page's branch selector reads
`revenue_channels` — the ONEST *Physical store* rows. The two do not agree, so the spend
report's branch column cannot currently be lined up against a branch budget.

## Basis and scope

- FY2026, department **Retail**, **approved basis** (`CEO_APPROVED` + `PAID`) — the spend
  report's default. Figures come from `v_request_spend`, so they are the same numbers the
  report shows.
- Total Retail FY2026 approved spend: **฿1,184,727.19**, of which **฿82,334.77** across 14
  requests carries no branch value at all.
- One value (`Unusual&Friend`) exists only at `BO_APPROVED` and so falls outside the
  approved basis; it is listed because it will enter the report the moment that request is
  approved.
- "Owners" are the **requesters** whose requests carry the value, with their occurrence
  count — not budget owners.

## Summary

| group | values | FY2026 spend |
|---|---|---|
| MATCH | 4 | ฿967,313.01 |
| RENAME | 4 | ฿56,992.15 |
| NEW | 1 | ฿53,365.06 |
| NOT A BRANCH | 1 | ฿24,722.20 |
| AMBIGUOUS | 0 | — |

Reconciling the RENAME group moves **฿56,992.15** onto existing channels and collapses two
pairs of split spellings. Nothing in the list is unplaceable.

---

## MATCH — byte-identical to an active channel

| value | bytes | len | requests | FY2026 spend | channel | requesters |
|---|---|---|---|---|---|---|
| `Song Wat` | `53 6f 6e 67 20 57 61 74` | 8 | 70 | **฿721,894.10** | Song Wat (Owned store) | panchita.t (80), thannaporn.s (13), paveena.c (10), noppatsorn.k (10), sitanun.n (6), noppatsorn.o (1) |
| `Talat Noi` | `54 61 6c 61 74 20 4e 6f 69` | 9 | 50 | **฿228,741.59** | Talat Noi (Owned store) | panchita.t (54), thannaporn.s (11), noppatsorn.k (10), paveena.c (4), sitanun.n (2), noppatsorn.o (1) |
| `Siam Discovery` | `53 69 61 6d 20 44 69 73 63 6f 76 65 72 79` | 14 | 12 | **฿15,503.53** | Siam Discovery (Specialty partners / sell) | panchita.t (7), thannaporn.s (5), chawanphat.b (2), paveena.c (2), noppatsorn.k (2) |
| `Gaysorn` | `47 61 79 73 6f 72 6e` | 7 | 3 | **฿1,173.79** | Gaysorn (Specialty partners / sell) | thannaporn.s (3) |

No action needed. Note `Gaysorn` and `Gaysorn Amarin` below are **both in use** — see RENAME.

---

## RENAME — the same place under another name

### Loft Eyes — one store, three spellings, spend split across all three

| value | bytes | len | requests | FY2026 spend | requesters |
|---|---|---|---|---|---|
| `Loft Eyes` | `4c 6f 66 74 20 45 79 65 73` | 9 | 5 | **฿29,762.00** | panchita.t (10) |
| `Lofteyes` | `4c 6f 66 74 65 79 65 73` | 8 | 3 | **฿14,681.00** | panchita.t (3) |
| **channel** `Loft eyes` | `4c 6f 66 74 20 65 79 65 73` | 9 | — | — | — |

**Split: ฿29,762.00 / ฿14,681.00 — ฿44,443.00 combined**, all from the same requester.
`Loft Eyes` differs from the channel by one byte (`45` vs `65`, capital E); `Lofteyes`
drops the space. Both normalise to `lofteyes`, so the importer's `norm()` already treats
all three as one — but the **spend report groups on the raw value**, so they appear as two
separate branches today.

⚠️ There is also a separate channel `Loft eyes-Thong Lor`. No spend value matches it yet,
so none of the above should be folded into it.

### Gaysorn Amarin → Gaysorn

| value | bytes | len | requests | FY2026 spend | requesters |
|---|---|---|---|---|---|
| `Gaysorn Amarin` | `47 61 79 73 6f 72 6e 20 41 6d 61 72 69 6e` | 14 | 3 | **฿12,065.35** | panchita.t (2), sitanun.n (2), thannaporn.s (2) |
| **channel** `Gaysorn` | `47 61 79 73 6f 72 6e` | 7 | — | — | — |

**Split: `Gaysorn` ฿1,173.79 / `Gaysorn Amarin` ฿12,065.35 — ฿13,239.14 combined.** Three
different requesters use the longer form, so this is a naming habit rather than one
person's typo. *Gaysorn Amarin* is a specific Gaysorn property — confirm these are the same
retail location and not two Gaysorn sites before merging.

### Nextopia (Ecotopia) → Ecotopia

| value | bytes | len | requests | FY2026 spend | requesters |
|---|---|---|---|---|---|
| `Nextopia (Ecotopia)` | `4e 65 78 74 6f 70 69 61 20 28 45 63 6f 74 6f 70 69 61 29` | 19 | 1 | **฿483.80** | sitanun.n (2) |
| **channel** `Ecotopia` | `45 63 6f 74 6f 70 69 61` | 8 | — | — | — |

The parenthetical names the channel outright. Lowest-value item in the list.

### Unusual&Friend → Unusual & Friend

| value | bytes | len | requests | spend | requesters |
|---|---|---|---|---|---|
| `Unusual&Friend` | `55 6e 75 73 75 61 6c 26 46 72 69 65 6e 64` | 14 | 1 | **฿228.00** *(BO_APPROVED — not in approved basis)* | panchita.t |
| **channel** `Unusual & Friend` | `55 6e 75 73 75 61 6c 20 26 20 46 72 69 65 6e 64` | 16 | — | — | — |

Spacing around `&` only; both normalise to `unusualfriend`. **Item-level only** —
`EXP-2026-10-000008`, whose header carries no branch. It will appear in the spend report as
its own branch as soon as that request is approved.

Worth noting: the revenue **sheet** has spelled this channel three ways during this
work — `UN&F` was reported, `Unusual & Friends` was what the sync actually saw, and it now
reads `Unusual & Friend`. An alias for `unusualfriends` already exists in
`lib/revenue-sheet.ts`, currently inert.

---

## NEW — a real store with no channel

| value | bytes | len | requests | FY2026 spend | requesters |
|---|---|---|---|---|---|
| `Dusit Central Park` | `44 75 73 69 74 20 43 65 6e 74 72 61 6c 20 50 61 72 6b` | 18 | 7 | **฿53,365.06** | sitanun.n (6), paveena.c (4), noppatsorn.k (4) |

Closest active channel is `Central Chidlom` (edit distance 12) — a **different** Central
property, not a match. Three requesters across seven requests, the second-largest
non-Owned-store figure in the list: this reads as a genuine location that was never added
as a channel.

**Deciding this creates a branch *and* a revenue channel** — they are the same entity.
Which sub-category it belongs to (Event, like Central Chidlom and Emporium? Specialty
partners?) is yours to set; the evidence here does not say.

---

## NOT A BRANCH

| value | bytes | len | requests | FY2026 spend | requesters |
|---|---|---|---|---|---|
| `All branch` | `41 6c 6c 20 62 72 61 6e 63 68` | 10 | 13 | **฿24,722.20** | panchita.t (18), thannaporn.s (4), sitanun.n (2), roengchai.s (2) |

**It means "the whole Retail estate", not a store** — cost incurred for every branch at
once, which is why it was typed into a field that only offers one. All 13 requests are
PAID, and the categories and descriptions are consistent:

- **In-Store Consumables & Supplies ×6** — bulk supplies for all stores: `สติ๊กเกอร์ onest
  ติดถุงกลับบ้าน 3 เดือน` (3 months of bag stickers), `STK ติดขวด TESTER หน้าร้านกันลอก`,
  petty-cash reconciliation
- **Retail ค่าเดินทาง ×5** — monthly travel *between* branches: `ค่าเดินทางไปสาขารอบช่วงสิ้นเดือนเมษายน`,
  `เบิกค่าเดินทางรอบเดือนMay 1-20/05/2026`
- **HR Salary ×2** — staff uniforms (`Uniform KA 2 ชุด`)

**Recommendation: map it to the `(no branch)` bucket**, which exists for exactly this and
already holds ฿82,334.77. That would make the bucket ฿107,056.97. Creating a channel called
"All branch" would put a non-store in the revenue hierarchy and let it be given a revenue
goal.

---

## AMBIGUOUS

None. Every value is placeable on the evidence.

---

## If you accept all of the above

| branch | FY2026 spend after reconciliation | change |
|---|---|---|
| Song Wat | ฿721,894.10 | — |
| Talat Noi | ฿228,741.59 | — |
| Loft eyes | **฿44,443.00** | +฿44,443.00 (two spellings merged) |
| Siam Discovery | ฿15,503.53 | — |
| Gaysorn | **฿13,239.14** | +฿12,065.35 |
| Dusit Central Park *(new)* | ฿53,365.06 | — |
| Ecotopia | **฿483.80** | +฿483.80 |
| (no branch) | **฿107,056.97** | +฿24,722.20 |
| **total** | **฿1,184,727.19** | **unchanged** |

The total must not move: this is a renaming exercise, not a re-costing. Any applied
migration should assert that, abort on mismatch, and snapshot before writing — the pattern
migrations 043 and 051 use.

## Things to decide before anything is applied

1. **Gaysorn Amarin and Gaysorn** — one location or two? Three requesters use the longer
   form, so this may be a real distinction rather than a typo.
2. **Dusit Central Park's sub-category** — Event or Specialty partners? It becomes a
   revenue channel either way, and if Specialty partners it also needs a `sell`/`use`/
   `closed` status.
3. **Whether to correct the stored values or map at read time.** Rewriting
   `requests.product` changes history, which this project has avoided elsewhere
   (`audit_log` in migration 038); an alias map leaves history intact but adds a layer
   every reader must go through. The budget↔spend comparison works either way.
4. **Whether `Loft eyes-Thong Lor` should be receiving any of this spend.** It is an active
   channel with a ฿45,000 FY2026 goal and no spend at all against it, which may itself be
   a recording gap rather than a quiet branch.
