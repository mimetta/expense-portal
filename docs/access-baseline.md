# Access baseline — what every person can do TODAY

Regenerated 2026-09-21 against the merged main (revenue goals +
department scoping, migrations 031-034 all applied), by calling the real permission functions
in `lib/permissions.ts`, `lib/settings-permissions.ts` and `lib/spend.ts` against live `roles`
data and all 1162 requests — not by reading code.

**This is the pass condition for the users & access rebuild.** After the rebuild every cell
below must be identical, except DEPT_HEAD's two settings grants moving to menu permissions.

## Pages each person can open

| Person | Roles | submit | my | procurement | bo-approvals | ceo-approvals | accounting | petty-cash | dashboard | budget | spend-report | settings |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `admin@mimetta.co` | SUPERADMIN | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `akanit.t@mimetta.co` | BO | Y | Y | · | Y | · | · | · | · | Y | Y | Y |
| `alissara.h@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `autteewara.n@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `chawanphat.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y | Y | · | Y | · | · | Y | · | Y | Y | Y |
| `chutikarn.p@mimetta.co` | ACCOUNTING | Y | Y | · | · | · | Y | · | Y | Y | Y | Y |
| `jaranya.s@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `kojchaphorn.s@mimetta.co` | BO, DEPT_HEAD | Y | Y | · | Y | · | · | · | · | Y | Y | Y |
| `ladda.t@mimetta.co` | ACCOUNTING, PETTY_CASH_CUSTODIAN | Y | Y | · | · | · | Y | Y | Y | Y | Y | Y |
| `mitdanai.s@mimetta.co` | CEO | Y | Y | · | · | Y | · | · | Y | Y | Y | Y |
| `nid.b@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `noppatsorn.o@mimetta.co` | BO | Y | Y | · | Y | · | · | · | · | Y | Y | Y |
| `panchita.t@mimetta.co` | BO, DEPT_HEAD, PETTY_CASH_CUSTODIAN | Y | Y | · | Y | · | · | Y | · | Y | Y | Y |
| `panwipa.s@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `phanida.c@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `pinprai.t@mimetta.co` | PROCUREMENT | Y | Y | Y | · | · | · | · | · | · | Y | Y |
| `roengchai.s@mimetta.co` | BO | Y | Y | · | Y | · | · | · | · | Y | Y | Y |
| `sawitree.p@mimetta.co` | ACCOUNTING | Y | Y | · | · | · | Y | · | Y | Y | Y | Y |
| `seedangkaew.k@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `siriwan.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y | Y | · | Y | · | · | Y | · | Y | Y | Y |
| `sitanun.n@mimetta.co` | BO, PETTY_CASH_CUSTODIAN, PROCUREMENT | Y | Y | Y | Y | · | · | Y | · | Y | Y | Y |
| `thannaporn.s@mimetta.co` | PETTY_CASH_CUSTODIAN | Y | Y | · | · | · | · | Y | · | · | Y | Y |
| `thanyarat.p@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `thita.s@mimetta.co` | CEO | Y | Y | · | · | Y | · | · | Y | Y | Y | Y |
| `thitiporn.j@mimetta.co` | DEPT_HEAD, PETTY_CASH_CUSTODIAN | Y | Y | · | · | · | · | Y | · | · | Y | Y |
| `tunyamon.p@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |
| `wacharanan.j@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y | Y | · | Y | · | · | Y | · | Y | Y | Y |
| `wannisa.p@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y | Y | · | Y | · | · | Y | · | Y | Y | Y |
| `wijitra.u@mimetta.co` | EMPLOYEE | Y | Y | · | · | · | · | · | · | · | Y | · |

## Settings tabs each person can open

| Person | suppliers | users | products | categories | deptconfig | announcements | pettycash | companies | people | permissions |
|---|---|---|---|---|---|---|---|---|---|---|
| `admin@mimetta.co` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `akanit.t@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `alissara.h@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `autteewara.n@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `chawanphat.b@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `chutikarn.p@mimetta.co` | Y | · | · | · | · | Y | Y | Y | · | · |
| `jaranya.s@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `kojchaphorn.s@mimetta.co` | Y | · | Y | · | · | · | · | · | · | · |
| `ladda.t@mimetta.co` | Y | · | · | · | · | Y | Y | Y | · | · |
| `mitdanai.s@mimetta.co` | · | · | · | · | Y | Y | · | · | · | · |
| `nid.b@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `noppatsorn.o@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `panchita.t@mimetta.co` | Y | · | Y | · | · | · | · | · | · | · |
| `panwipa.s@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `phanida.c@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `pinprai.t@mimetta.co` | Y | · | Y | · | · | · | · | · | · | · |
| `roengchai.s@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `sawitree.p@mimetta.co` | Y | · | · | · | · | Y | Y | Y | · | · |
| `seedangkaew.k@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `siriwan.b@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `sitanun.n@mimetta.co` | Y | · | Y | · | · | · | · | · | · | · |
| `thannaporn.s@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `thanyarat.p@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `thita.s@mimetta.co` | · | · | · | · | Y | Y | · | · | · | · |
| `thitiporn.j@mimetta.co` | Y | · | Y | · | · | · | · | · | · | · |
| `tunyamon.p@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `wacharanan.j@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `wannisa.p@mimetta.co` | · | · | · | · | · | · | · | · | · | · |
| `wijitra.u@mimetta.co` | · | · | · | · | · | · | · | · | · | · |

## Actions, and effective scope

"reach" = how many of the 1162 real requests the predicate returns true for.

| Person | Roles | BO approve (reach) | Petty cash sign-off (reach) | CEO approve | Mark paid | Procurement edit | Manage products | Set revenue goals | Can view (reach) |
|---|---|---|---|---|---|---|---|---|---|
| `admin@mimetta.co` | SUPERADMIN | Y (1162) | Y (1162) | Y | Y | Y | Y | Y | 1162 |
| `akanit.t@mimetta.co` | BO | Y (37) | · | · | · | · | · | · | 37 |
| `alissara.h@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 1 |
| `autteewara.n@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 24 |
| `chawanphat.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y (99) | Y (0) | · | · | · | · | · | 107 |
| `chutikarn.p@mimetta.co` | ACCOUNTING | · | · | · | Y | · | · | · | 1162 |
| `jaranya.s@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 9 |
| `kojchaphorn.s@mimetta.co` | BO, DEPT_HEAD | Y (45) | · | · | · | · | Y | · | 57 |
| `ladda.t@mimetta.co` | ACCOUNTING, PETTY_CASH_CUSTODIAN | · | Y (0) | · | Y | · | · | · | 1162 |
| `mitdanai.s@mimetta.co` | CEO | · | · | Y | · | · | · | Y | 1162 |
| `nid.b@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 3 |
| `noppatsorn.o@mimetta.co` | BO | Y (102) | · | · | · | · | · | · | 113 |
| `panchita.t@mimetta.co` | BO, DEPT_HEAD, PETTY_CASH_CUSTODIAN | Y (196) | Y (3) | · | · | · | Y | · | 205 |
| `panwipa.s@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 0 |
| `phanida.c@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 11 |
| `pinprai.t@mimetta.co` | PROCUREMENT | · | · | · | · | Y | Y | · | 1162 |
| `roengchai.s@mimetta.co` | BO | Y (69) | · | · | · | · | · | · | 82 |
| `sawitree.p@mimetta.co` | ACCOUNTING | · | · | · | Y | · | · | · | 1162 |
| `seedangkaew.k@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 18 |
| `siriwan.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y (415) | Y (17) | · | · | · | · | · | 423 |
| `sitanun.n@mimetta.co` | BO, PETTY_CASH_CUSTODIAN, PROCUREMENT | Y (1) | Y (4) | · | · | Y | Y | · | 1162 |
| `thannaporn.s@mimetta.co` | PETTY_CASH_CUSTODIAN | · | Y (8) | · | · | · | · | · | 188 |
| `thanyarat.p@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 17 |
| `thita.s@mimetta.co` | CEO | · | · | Y | · | · | · | Y | 1162 |
| `thitiporn.j@mimetta.co` | DEPT_HEAD, PETTY_CASH_CUSTODIAN | · | Y (3) | · | · | · | Y | · | 33 |
| `tunyamon.p@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 46 |
| `wacharanan.j@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y (154) | Y (7) | · | · | · | · | · | 156 |
| `wannisa.p@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | Y (36) | Y (16) | · | · | · | · | · | 157 |
| `wijitra.u@mimetta.co` | EMPLOYEE | · | · | · | · | · | · | · | 2 |

## Spend report scope (NEW — migration 034)

`lib/spend.ts#scopeFilter`: CEO/ACCOUNTING/SUPERADMIN see all; a BO sees their BO rows'
scope; everyone else sees `roles.department`, or nothing if it is empty.

| Person | roles | roles.department | what the spend report shows |
|---|---|---|---|
| `admin@mimetta.co` | SUPERADMIN | *(empty)* | everything (role) |
| `akanit.t@mimetta.co` | BO | *(empty)* | their BO scope (unchanged) |
| `alissara.h@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `autteewara.n@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `chawanphat.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | *(empty)* | their BO scope (unchanged) |
| `chutikarn.p@mimetta.co` | ACCOUNTING | *(empty)* | everything (role) |
| `jaranya.s@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `kojchaphorn.s@mimetta.co` | BO, DEPT_HEAD | *(empty)* | their BO scope (unchanged) |
| `ladda.t@mimetta.co` | ACCOUNTING, PETTY_CASH_CUSTODIAN | *(empty)* | everything (role) |
| `mitdanai.s@mimetta.co` | CEO | *(empty)* | everything (role) |
| `nid.b@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `noppatsorn.o@mimetta.co` | BO | *(empty)* | their BO scope (unchanged) |
| `panchita.t@mimetta.co` | BO, DEPT_HEAD, PETTY_CASH_CUSTODIAN | *(empty)* | their BO scope (unchanged) |
| `panwipa.s@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `phanida.c@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `pinprai.t@mimetta.co` | PROCUREMENT | *(empty)* | **nothing — no department assigned** |
| `roengchai.s@mimetta.co` | BO | *(empty)* | their BO scope (unchanged) |
| `sawitree.p@mimetta.co` | ACCOUNTING | *(empty)* | everything (role) |
| `seedangkaew.k@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `siriwan.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | *(empty)* | their BO scope (unchanged) |
| `sitanun.n@mimetta.co` | BO, PETTY_CASH_CUSTODIAN, PROCUREMENT | *(empty)* | their BO scope (unchanged) |
| `thannaporn.s@mimetta.co` | PETTY_CASH_CUSTODIAN | People (HR) | only People (HR) |
| `thanyarat.p@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `thita.s@mimetta.co` | CEO | *(empty)* | everything (role) |
| `thitiporn.j@mimetta.co` | DEPT_HEAD, PETTY_CASH_CUSTODIAN | *(empty)* | **nothing — no department assigned** |
| `tunyamon.p@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |
| `wacharanan.j@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | *(empty)* | their BO scope (unchanged) |
| `wannisa.p@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | *(empty)* | their BO scope (unchanged) |
| `wijitra.u@mimetta.co` | EMPLOYEE | *(empty)* | **nothing — no department assigned** |

## Raw scope columns per row

| Person | role | bu_scope | dept_scope | cat_l1_scope | department | chapter |
|---|---|---|---|---|---|---|
| `admin@mimetta.co` | SUPERADMIN | `*` | `*` | `*` | `` |  |
| `akanit.t@mimetta.co` | BO | `SV` | `Marketing` | `Affiliate,Brand Material & Packaging Design,CRM,Content Production,E-Commerce,Live,MKT Software & Tools,Marketing Influencer/KOLs,Paid Advertising,Supporting Budget,Website,CRM & Retention` | `` | Marketing |
| `alissara.h@mimetta.co` | EMPLOYEE | `ONEST` | `Marketing` | `Brand Building,CRM & Retention,Infrastructure & Operations,Revenue & Conversion,Supporting Budget` | `` | Marketing |
| `autteewara.n@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |
| `chawanphat.b@mimetta.co` | PETTY_CASH_CUSTODIAN | `*` | `Marketing,Merchandise` | `Affiliate,Brand Building,Brand Material & Packaging Design,CRM,CRM & Retention,Content Production,E-Commerce,Infrastructure & Operations,Live,MKT Software & Tools,Marketing Influencer/KOLs,Paid Advertising,Revenue & Conversion,Supporting Budget,Website,NPD` | `` | — |
| `chawanphat.b@mimetta.co` | BO | `ONEST` | `Marketing,Merchandise` | `Brand Building,CRM & Retention,Infrastructure & Operations,Revenue & Conversion,Supporting Budget,NPD,Replenishing,Marketing Influencer/KOLs,Content Production,E-Commerce` | `` | Marketing |
| `chutikarn.p@mimetta.co` | ACCOUNTING | `*` | `*` | `*` | `` | Backbone |
| `jaranya.s@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |
| `kojchaphorn.s@mimetta.co` | DEPT_HEAD | `ONEST` | `R&D` | `*` | `` | Innovation |
| `kojchaphorn.s@mimetta.co` | BO | `ONEST` | `Lab Instrument Investment,R&D` | `Equipment for Sample Preparation & Cultivation,Measurement & Analysis Instruments,Small Equipment/Tools,Weighing Instruments,Consumables,Process Dev,Product Dev,RD Other expenses,Regulatory Compliance` | `` | Innovation |
| `ladda.t@mimetta.co` | ACCOUNTING | `*` | `*` | `*` | `` | Backbone |
| `ladda.t@mimetta.co` | PETTY_CASH_CUSTODIAN | `ONEST` | `General Administrative` | `*` | `` | — |
| `mitdanai.s@mimetta.co` | CEO | `*` | `*` | `*` | `` | Strategy |
| `nid.b@mimetta.co` | EMPLOYEE | `*` | `*` | `*` | `` | Marketing |
| `noppatsorn.o@mimetta.co` | BO | `*` | `General Administrative` | `*` | `` | Backbone |
| `panchita.t@mimetta.co` | DEPT_HEAD | `ONEST` | `Retail` | `In-Store Consumables & Supplies,Insurance,Land and building Taxe,Maintenance & Repairs,Media & Materials,Retail ค่าเดินทาง,Signboard Taxe,Store Fixed cost,Utilities,KA Training,Supporting Budget` | `` | Marketing |
| `panchita.t@mimetta.co` | BO | `*` | `Retail,New Store Investment` | `In-Store Consumables & Supplies,Insurance,Land and building Taxe,Maintenance & Repairs,Media & Materials,Retail ค่าเดินทาง,Signboard Taxe,Store Fixed cost,Utilities,Deposits & Legal Setup,Factory Investment,Lab Instrument Investment (RD),POS & Technology Setup,Store Decoration & Branding,Store Design & Construction,Store Fixtures & Equipment,Supporting Budget,KA Training` | `` | Marketing |
| `panchita.t@mimetta.co` | PETTY_CASH_CUSTODIAN | `ONEST` | `Retail` | `In-Store Consumables & Supplies,Insurance,KA Training,Land and building Taxe,Maintenance & Repairs,Media & Materials,Retail ค่าเดินทาง,Signboard Taxe,Store Fixed cost,Supporting Budget,Utilities` | `` | — |
| `panwipa.s@mimetta.co` | EMPLOYEE | `*` | `*` | `*` | `` | — |
| `phanida.c@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |
| `pinprai.t@mimetta.co` | PROCUREMENT | `*` | `*` | `*` | `` | Backbone |
| `roengchai.s@mimetta.co` | BO | `*` | `Operations/Fulfillment` | `Fulfillment operation consumables,Logistics & Shipping,Maintenance,Software & Tools,Warehouse,ค่าเดินทางพนักงาน Fulfillment` | `` | Factory |
| `sawitree.p@mimetta.co` | ACCOUNTING | `SV` | `*` | `*` | `` | Backbone |
| `seedangkaew.k@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |
| `siriwan.b@mimetta.co` | BO | `*` | `Factory Investment` | `*` | `` | — |
| `siriwan.b@mimetta.co` | PETTY_CASH_CUSTODIAN | `*` | `COG,Factory Investment` | `Direct Labour - COG,Direct Material - COG,Factory Operation (OH) - COG,Building & Construction,Logistic & Warehouse,New Machine,Production Equipment` | `` | — |
| `siriwan.b@mimetta.co` | BO | `*` | `COG` | `Direct Labour - COG,Direct Material - COG,Factory Consumable,Factory Operation (OH) - COG,NPD,Raw Materials` | `` | Factory |
| `sitanun.n@mimetta.co` | PROCUREMENT | `*` | `*` | `*` | `` | Backbone |
| `sitanun.n@mimetta.co` | PETTY_CASH_CUSTODIAN | `*` | `Marketing,Merchandise,New Store Investment,OEM,R&D` | `Affiliate,Brand Building,Brand Material & Packaging Design,CRM,CRM & Retention,Content Production,E-Commerce,Infrastructure & Operations,Live,MKT Software & Tools,Marketing Influencer/KOLs,Paid Advertising,Revenue & Conversion,Supporting Budget,Website,Deposits & Legal Setup,Factory Investment,Lab Instrument Investment (RD),POS & Technology Setup,Store Decoration & Branding,Store Design & Construction,Store Fixtures & Equipment,NPD,OEM Service fee,Replenishing,Direct Material - COG,Product Dev` | `` | — |
| `sitanun.n@mimetta.co` | BO | `*` | `OEM` | `*` | `` | — |
| `thannaporn.s@mimetta.co` | PETTY_CASH_CUSTODIAN | `SV` | `*` | `*` | `People (HR)` | Backbone |
| `thanyarat.p@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |
| `thita.s@mimetta.co` | CEO | `*` | `*` | `*` | `` | Strategy |
| `thitiporn.j@mimetta.co` | PETTY_CASH_CUSTODIAN | `ONEST` | `R&D` | `Consumables,Process Dev,Product Dev,RD Other expenses,Regulatory Compliance` | `` | — |
| `thitiporn.j@mimetta.co` | DEPT_HEAD | `ONEST` | `R&D` | `*` | `` | Innovation |
| `tunyamon.p@mimetta.co` | EMPLOYEE | `SV` | `*` | `*` | `` | Innovation |
| `wacharanan.j@mimetta.co` | BO | `*` | `COG,Marketing,Operations/Fulfillment,People (HR),R&D,Retail` | `Stock Staff (Warehouse),Logistic Staff (pick/pack/delivery),HR Benefits,HR Operation,HR Operation - Software & Tools,HR Salary,HRD` | `` | Backbone |
| `wacharanan.j@mimetta.co` | PETTY_CASH_CUSTODIAN | `*` | `COG,Marketing,Operations/Fulfillment,People (HR),R&D,Retail` | `Stock Staff (Warehouse),Logistic Staff (pick/pack/delivery),HR Benefits,HR Operation,HR Operation - Software & Tools,HR Salary,HRD` | `` | — |
| `wannisa.p@mimetta.co` | PETTY_CASH_CUSTODIAN | `SV` | `COG` | `Direct Labour - COG,Direct Material - COG,Factory Operation (OH) - COG` | `` | — |
| `wannisa.p@mimetta.co` | BO | `SV` | `R&D` | `Consumables,Legal & Compliance,Process Dev,Product Dev,RD Other expenses,Regulatory Compliance` | `` | Factory |
| `wijitra.u@mimetta.co` | EMPLOYEE | `ONEST` | `*` | `*` | `` | Marketing |

## Submit-form Business Unit (reads bu_scope on EVERY role row)

`RequestForm#resolvedBu` takes the first non-`*` `bu_scope` across ALL rows regardless of
role and stamps it read-only on every submission. **This is why the rebuild must keep a
per-person BU** — see the Stage 1 findings.

| Person | roles | bu_scope values | BU stamped | from a non-BO row? |
|---|---|---|---|---|
| `admin@mimetta.co` | SUPERADMIN | * | **ONEST** (default) | n/a |
| `akanit.t@mimetta.co` | BO | SV | **SV** | no (BO row) |
| `alissara.h@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `autteewara.n@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `chawanphat.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | * / ONEST | **ONEST** | no (BO row) |
| `chutikarn.p@mimetta.co` | ACCOUNTING | * | **ONEST** (default) | n/a |
| `jaranya.s@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `kojchaphorn.s@mimetta.co` | BO, DEPT_HEAD | ONEST / ONEST | **ONEST** | **YES — DEPT_HEAD row** |
| `ladda.t@mimetta.co` | ACCOUNTING, PETTY_CASH_CUSTODIAN | * / ONEST | **ONEST** | **YES — PETTY_CASH_CUSTODIAN row** |
| `mitdanai.s@mimetta.co` | CEO | * | **ONEST** (default) | n/a |
| `nid.b@mimetta.co` | EMPLOYEE | * | **ONEST** (default) | n/a |
| `noppatsorn.o@mimetta.co` | BO | * | **ONEST** (default) | n/a |
| `panchita.t@mimetta.co` | BO, DEPT_HEAD, PETTY_CASH_CUSTODIAN | ONEST / * / ONEST | **ONEST** | **YES — DEPT_HEAD row** |
| `panwipa.s@mimetta.co` | EMPLOYEE | * | **ONEST** (default) | n/a |
| `phanida.c@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `pinprai.t@mimetta.co` | PROCUREMENT | * | **ONEST** (default) | n/a |
| `roengchai.s@mimetta.co` | BO | * | **ONEST** (default) | n/a |
| `sawitree.p@mimetta.co` | ACCOUNTING | SV | **SV** | **YES — ACCOUNTING row** |
| `seedangkaew.k@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `siriwan.b@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | * / * / * | **ONEST** (default) | n/a |
| `sitanun.n@mimetta.co` | BO, PETTY_CASH_CUSTODIAN, PROCUREMENT | * / * / * | **ONEST** (default) | n/a |
| `thannaporn.s@mimetta.co` | PETTY_CASH_CUSTODIAN | SV | **SV** | **YES — PETTY_CASH_CUSTODIAN row** |
| `thanyarat.p@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |
| `thita.s@mimetta.co` | CEO | * | **ONEST** (default) | n/a |
| `thitiporn.j@mimetta.co` | DEPT_HEAD, PETTY_CASH_CUSTODIAN | ONEST / ONEST | **ONEST** | **YES — PETTY_CASH_CUSTODIAN row** |
| `tunyamon.p@mimetta.co` | EMPLOYEE | SV | **SV** | **YES — EMPLOYEE row** |
| `wacharanan.j@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | * / * | **ONEST** (default) | n/a |
| `wannisa.p@mimetta.co` | BO, PETTY_CASH_CUSTODIAN | SV / SV | **SV** | **YES — PETTY_CASH_CUSTODIAN row** |
| `wijitra.u@mimetta.co` | EMPLOYEE | ONEST | **ONEST** | **YES — EMPLOYEE row** |

## settings_tab_permissions, as stored

| tab | roles |
|---|---|
| `announcements` | `CEO,ACCOUNTING` |
| `categories` | `` |
| `companies` | `ACCOUNTING` |
| `deptconfig` | `CEO` |
| `pettycash` | `ACCOUNTING` |
| `products` | `PROCUREMENT,DEPT_HEAD,PRODUCT_MANAGER` |
| `suppliers` | `ACCOUNTING,PROCUREMENT,DEPT_HEAD,SUPPLIER_MANAGER` |
| `users` | `` |
