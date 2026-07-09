# Mimetta Expense Portal

Internal expense request and approval portal for **Mimetta** (formerly Coroand Co.), a Thai
consumer goods company operating two business units: **SV** and **ONEST**.

The system handles multi-stage expense approvals from submission through payment, with
role-based access, department scoping, PO upload workflow, digital signing, Discord
notifications, and a budget dashboard.

**Legacy system:** Google Apps Script + Google Sheets + Google Sites (being replaced)
**Current stack:** Next.js 14 (App Router, TypeScript) + Supabase (PostgreSQL) + Vercel + Discord

---

## Email Domain Migration

Old domain `@coroand.co` → new domain `@mimetta.co`, same username prefix
(`noppatsorn.k@coroand.co` → `noppatsorn.k@mimetta.co`).

Only `@mimetta.co` accounts may sign in. Enforced twice:
1. `queryParams: { hd: "mimetta.co" }` on the Google OAuth request (`app/login/page.tsx`) —
   narrows the Google account picker, but is a UX hint only, not a security boundary.
2. Server-side re-check in `app/auth/callback/route.ts` and `lib/supabase/middleware.ts`
   (`isAllowedDomain()` in `lib/domain.ts`) — signs out and redirects to
   `/auth/auth-error?reason=domain` if the authenticated email isn't `@mimetta.co`.

The one-time migration script that finds-and-replaces `@coroand.co` → `@mimetta.co` in every
email column (`roles.email`, `requests.requester_email/bo_approver/ceo_approver/
accounting_user/po_uploaded_by/rejected_by`, `audit_log.actor_email`, `dept_config.bo_email`)
is now `scripts/migrate-from-sheets.ts` — see "Legacy data migration script" below. Earlier
revisions of this doc said this script was "not included in this repo, run manually" — that
was true before this script existed; it's now a real, checked-in, dry-run-by-default script
covering the same email swap plus department/category name normalization. Preserve all
`request_id` values exactly (`EXP-YYYY-MM-NNNNNN`) — the script never touches that column.
Historical data is migrated as live, editable records — not read-only archives.

---

## Company Structure

**Business Units:** `SV`, `ONEST` (`lib/constants.ts` → `BUSINESS_UNITS`)

**Departments:** Marketing, R&D, Factory, Factory Investment, Store Investment,
Operations/Fulfillment, Retail, General Administrative, People & HR & System, Merchandise,
OEM, Lab Instrument Investment, COG (`lib/constants.ts` → `DEPARTMENTS`)

**Currency:** Thai Baht (THB). Expense type names are kept in Thai exactly as specified —
never translate or reword them (`lib/constants.ts` → `EXPENSE_TYPES`).

---

## Roles & Permissions

| Role | Access |
|---|---|
| `SUPERADMIN` | Full access to every page |
| `CEO` | CEO Approvals |
| `ACCOUNTING` | Accounting |
| `BO` | Budget Owner approvals, scoped by `bu_scope` / `dept_scope` / `cat_l1_scope` |
| `PROCUREMENT` | Procurement |
| `EMPLOYEE` | Submit + My Requests |

A user can hold multiple rows in `roles` (multi-role). **Always check the full set of a
user's roles — never a single "primary" role.** `lib/auth.ts` loads every `roles` row for the
signed-in email into `CurrentUser.allRoles`; `lib/permissions.ts` (`hasRole`, `rolesOf`,
`canBoActOnRequest`) always iterates that array.

BO scoping (`bu_scope`, `dept_scope`, `cat_l1_scope` — comma-separated, or `*` for
unrestricted) is matched per-row in `lib/permissions.ts#boScopeMatchesRequest`. A BO with
several scope rows can act on a request if **any** row matches (`canBoActOnRequest`).

**Page access is not fully spelled out per-role in the original spec** — the following was
inferred and should be revisited if wrong:
- Every `@mimetta.co` user gets Submit + My Requests regardless of other roles (everyone can
  incur expenses).
- `/dashboard`'s `canAccessPage` entry (`SUPERADMIN`/`CEO`/`ACCOUNTING`) is now moot in
  practice — the route unconditionally redirects to `/` regardless of role (see "Dashboard nav
  removal" below), so this check never actually gets exercised, but was left in place rather
  than removed since the underlying page/data still exist.
- `/settings` is granted to every role **except** a pure `EMPLOYEE` (see "Settings tab
  permissions" below for which of its six tabs each role actually sees once inside).
- See `canAccessPage()` in `lib/permissions.ts` to adjust.

Page access is enforced twice: server-side redirect in each gated page's `page.tsx`
(`getCurrentUser` + `canAccessPage`, redirects to `/login` or `/`), and again in every API
route handler (the actual security boundary — pages are just UX).

### Auto-registration for new @mimetta.co users

`lib/auth.ts#getCurrentUser()` used to return a `CurrentUser` with an empty `allRoles` array
for anyone signed in but never added to `roles` — authenticated, but with access to nothing
beyond Submit/My Requests being *possible* to reach (nothing gated any further ever matched).
It now auto-registers them instead: if the `roles` query for their email comes back empty (and
they've already passed the `@mimetta.co` domain check above — a non-`@mimetta.co` account is
rejected before this ever runs, via the existing `isAllowedDomain` gate), it `.upsert()`s
`{ email, role: 'EMPLOYEE', bu_scope: '*', dept_scope: '*', cat_l1_scope: '*',
is_auto_registered: true }` and logs `AUTO_REGISTERED`. Upsert (against the table's existing
unique constraint on `(email, role, bu_scope, dept_scope, cat_l1_scope)`) rather than a plain
insert, since a first-ever page load typically fires several parallel `requireUser()` calls at
once (the page itself plus its client-side fetches) that would otherwise race to insert
simultaneously — on conflict this just re-writes the identical row and returns it.

`roles.is_auto_registered` (new column, `supabase/migrations/007_roles_update.sql`) is how the
rest of the app knows this happened: `components/Nav.tsx` shows a dismissible yellow banner
("⚠️ บัญชีของคุณยังไม่ได้รับการกำหนดสิทธิ์ กรุณาติดต่อ Admin เพื่อขอสิทธิ์การใช้งาน" —
`#FEF3C7`/`#F59E0B`/`#92400E`) on every page whenever any of the signed-in user's roles rows
has it set. It clears the moment an admin actually touches that row: `PATCH
/api/roles/[id]` unconditionally forces `is_auto_registered: false` into every update,
whether that's a superadmin editing fields on purpose or clicking "Assign Role" from the
Pending Users section below (same edit modal, same endpoint) — either way, an admin having
looked at the row is exactly the condition that should make the banner go away.

Settings > User Management surfaces these for admin attention via a **separate, and
deliberately different, "pending" definition**: `role = EMPLOYEE AND created_at is within the
last 7 days AND this is the user's only roles row` (`getPendingUsers()` in
`settingsClient.tsx`) — not `is_auto_registered`. The two conditions usually coincide but
aren't the same thing: this one is time-windowed (so an unaddressed row eventually drops off
the "New" badge/Pending Users section on its own after a week, rather than nagging forever)
and doesn't care how the row was created, whereas `is_auto_registered` is permanent-until-
edited and specifically means "this exact row was auto-created." Each is used for the UI it
fits: the row-scoped `is_auto_registered` flag for "does *this* signed-in user need the
yellow reminder", the time/count-scoped definition for "which users does *an admin* still
need to look at."

`roles.created_at` was already a column (`001_initial_schema.sql`, `not null default now()`)
— migration 007's `ADD COLUMN IF NOT EXISTS created_at ...` is a harmless no-op, kept only so
the migration file is self-contained if it's ever the first one applied against a from-scratch
database.

---

## Approval Status Flow

```
normal:            SUBMITTED → PO_UPLOADED → BO_APPROVED → CEO_APPROVED → PAID
no PO:              SUBMITTED → BO_APPROVED → CEO_APPROVED → PAID
skip BO:            SUBMITTED → PO_UPLOADED → CEO_APPROVED → PAID
skip BO + no PO:    SUBMITTED → CEO_APPROVED → PAID
```

The only other terminal status is `REJECTED`. **`EXPIRED` has been removed** (previously:
PO_UPLOADED not acted on within 48h, enforced by a `/api/cron/expire` Vercel Cron job) — the
cron route, its `vercel.json` entry, `CRON_SECRET`, and `PO_EXPIRY_HOURS` are all gone. The
`requests.status` CHECK constraint no longer allows `'EXPIRED'` (see
`supabase/migrations/004_new_features.sql` — the `requests` table was empty when this was
written, so there was no historical data to migrate).

`requires_po` and `skip_bo` (booleans on `requests`, resolved at submission time from
`dept_config`) determine which statuses a request passes through. The "is this request
actionable at my stage" checks live in `lib/status.ts`:
`needsProcurement` / `isBoActionable` / `isCeoActionable` / `isAccountingActionable`.

`EDIT_REQUESTED` is a fifth non-terminal status, added for the Edit Request approval workflow
(see below) — a request only ever passes through it after already reaching `BO_APPROVED`,
`CEO_APPROVED`, or `PAID`, and always returns to exactly the status it was in before (never
forward). It sits outside the normal linear flow above rather than extending it.

### Edit Request approval workflow

An escape hatch for a requester who needs to change a request that's already past
`isOwnerEditable`'s free-edit window (SUBMITTED, untouched by Procurement — see "Owner edit
permission" below): once a request reaches `BO_APPROVED`, `CEO_APPROVED`, or `PAID`, the owner
can ask the current-stage approver for permission to edit it, rather than editing being
permanently locked out. Two-phase state machine, deliberately not a single status flip:

1. **Request** — `PATCH /api/requests/[id]/request-edit` (requester or SUPERADMIN, body
   `{ reason }`). Only sets `edit_requested_at`/`edit_requested_reason` — **status does not
   change**, so the request stays visible/actionable wherever it already was until an
   approver actually acts. `lib/status.ts#canRequestEdit` gates this to
   `BO_APPROVED`/`CEO_APPROVED`/`PAID` with no edit request already pending;
   `isEditRequestPending` is true from this point until step 2. Posts to the department
   Discord channel naming the approver (BO_APPROVED → `bo_approver`; CEO_APPROVED →
   `ceo_approver`; PAID → Accounting, hardcoded `ladda.t@mimetta.co`/`chutikarn.p@mimetta.co`
   since there's no Accounting-role-scoped lookup elsewhere in this schema) — same "no literal
   per-user Discord DM" constraint as the document-reminder cron, so the approver is named in
   the message text rather than actually pinged.
2. **Approve/reject** — `PATCH /api/requests/[id]/approve-edit` (the approver at whichever
   stage the request is currently sitting at — `lib/status.ts#editRequestApproverStage` returns
   `"BO"|"CEO"|"ACCOUNTING"` — or SUPERADMIN; body `{ allow: boolean }`).
   - **Allow**: status flips to `EDIT_REQUESTED`, `status_before_edit` is stamped with the
     request's status *before* this flip (so `BO_APPROVED`/`CEO_APPROVED`/`PAID`, never
     `EDIT_REQUESTED` itself), and `edit_approved_by`/`edit_approved_at` are set.
     `lib/status.ts#isEditApproved` (`status === "EDIT_REQUESTED" && edit_approved_by` set) now
     unlocks the owner's full-form edit.
   - **Reject**: only clears `edit_requested_at`/`edit_requested_reason` — status was never
     touched, so there's nothing to revert. Posts a rejection notice to the department channel.
3. **Resubmit** — `PATCH /api/requests/[id]` with `{ edit_resubmit: true, ...fields }` (the
   6th and final mutually-exclusive branch of that endpoint — see "PATCH
   /api/requests/[id]" below), gated on `isEditApproved`. Same full editable-field set as
   `resubmit`/`owner_edit` via `buildEditableFields`, but the target status is
   `status_before_edit` (not `rejected_stage` — this is a different field for a different
   flow) and all five `edit_*` markers are cleared back to null. Fires whichever
   Discord notification matches the landed-on status (`BO_APPROVED`/`CEO_APPROVED`/`PAID`).

Database columns (`supabase/migrations/009_edit_request.sql`): `edit_requested_at
TIMESTAMPTZ`, `edit_requested_reason TEXT`, `edit_approved_by TEXT`, `edit_approved_at
TIMESTAMPTZ` (the migration spec as given said `TEXT` for this column — corrected to
`TIMESTAMPTZ` to match every other `_at` column's convention in the schema), and
`status_before_edit TEXT`, plus dropping/recreating the `requests_status_check` CHECK
constraint to allow `'EDIT_REQUESTED'` (same pattern `004_new_features.sql` used to *remove*
`'EXPIRED'`). Both new routes catch Postgrest's `42703` ("column does not exist") and return a
friendly 503 if this migration hasn't been applied yet, same graceful-degradation pattern as
the `is_auto_registered` fallback.

UI: My Requests shows a "✏️ Request Edit" button (via `canRequestEdit`) that opens a small
reason-prompt modal, an "Edit requested — awaiting approval" sublabel while pending, and an
"↩ Edit & Resubmit" button once `isEditApproved` — reusing the same `EditRequestModal` /
`RequestForm` component as the REJECTED edit-and-resubmit flow, with a third banner/label
branch for this case. BO Approvals, CEO Approvals, and Accounting each gained an "Edit
Requests (N)" tab (`GET /api/requests?scope=bo|ceo|accounting&tab=edit-requests`, filtered to
`isEditRequestPending` at that stage's status) showing the reason and Allow/Reject buttons,
mirrored in `RequestDetailModal`'s `actions` prop when a pending edit request is open there.

`EDIT_REQUESTED` was added to `lib/discord.ts`'s `NotificationEvent` union and
`lib/resubmit.ts`'s `NOTIFY_EVENT_FOR_STATUS` map purely for TypeScript exhaustiveness — the
real Edit Request notifications (steps 1 and 2 above) are bespoke `postToWebhook` calls
outside the `notify()`/`NotificationEvent` mechanism, since they need to name a specific
approver, which doesn't fit that mechanism's fixed per-status message shape. This case is
unreachable in practice.

### Rejection & Resubmit

A rejected request can only be **resubmitted** (status change) within `RESUBMIT_WINDOW_HOURS`
(24h) of `rejected_at` — reflected in the UI as a live countdown (`app/my/page.tsx`,
`lib/status.ts#canResubmit`/`resubmitDeadline`). After the window closes, resubmit is no
longer offered and the request stays `REJECTED` permanently — there is no automated cleanup
of these (unlike the old `EXPIRED` cron). **Plain editing** of a rejected request's content
(status unchanged) has no time limit — only the status transition is time-boxed.

Resubmit steps the request backward by exactly **one** stage rather than restarting the whole
approval chain. This falls directly out of how `rejected_stage` is already captured in
`POST /api/requests/[id]/reject` — it's set to `existing.status`, i.e. the status the request
was already resting in immediately before the rejecting reviewer acted. Restoring
`status = rejected_stage` on resubmit is therefore exactly "one stage back": rejected during
Procurement (`SUBMITTED`) → back to `SUBMITTED`; rejected at BO (`PO_UPLOADED` or `SUBMITTED`
depending on `requires_po`) → back to that same status; rejected at CEO (`BO_APPROVED`) → back
to `BO_APPROVED`; rejected at Accounting (`CEO_APPROVED`) → back to `CEO_APPROVED`. Because of
this, fields for stages at or before the target status (`po_*`/`bo_*`/`ceo_*`) are **not**
cleared on resubmit — only the rejection markers (`rejected_by`/`rejected_stage`/
`reject_reason`/`rejected_at`) are.

This logic lives in `lib/resubmit.ts` (`buildEditableFields`, `resubmitTargetStatus`,
`resubmitRequest`), shared by two entry points:
- `PATCH /api/requests/[id]/resubmit` — dedicated route, kept for backward compatibility.
- `PATCH /api/requests/[id]` with `{ resubmit: true, ...fields }` in the body — the same
  operation through the unified per-request route (see below). Both call the same
  `resubmitRequest()`, so behavior is identical either way.

The My Requests **Edit & Resubmit modal** (`app/my/page.tsx#EditResubmitModal`) is not a
separate hand-built form — it renders `components/shared/RequestForm.tsx` (the exact same
component `/submit` uses, in "edit" mode via its `initial` prop), so it has genuinely
identical fields, dropdowns, and conditional logic to Submit by construction, not by
duplication. It offers two buttons: **Save Changes** (plain `PATCH .../[id]`, no `resubmit`
flag, works any time status is `REJECTED`) and **Save & Resubmit** (adds `resubmit: true`,
only shown/enabled within the 24h window). Both exclude `request_id`/`requester_email`/
`timestamp` — those are never part of `RequestFormPayload`.

### PATCH /api/requests/[id] — unified per-request edit endpoint

One route, six mutually-exclusive behaviors gated by request status / body shape (see
`app/api/requests/[id]/route.ts`):

1. **`{ resubmit: true, ... }`** — only when `status === "REJECTED"`. Requester or
   SUPERADMIN. Delegates to `lib/resubmit.ts#resubmitRequest` (see above).
2. **`{ attach_signature: true, files_json }`** — BO/CEO attaching a signed PDF during their
   own actionable stage (see "PDF document signing" below). Only `files_json` changes.
3. **`{ owner_edit: true, ... }`** — requester freely editing their own request's full
   content while `lib/status.ts#isOwnerEditable` holds (`status === "SUBMITTED"` and
   `po_number`/`po_uploaded_by`/`po_uploaded_at` are all still empty — i.e. Procurement hasn't
   touched it yet). Status unchanged. Requester or SUPERADMIN. Same full field set as
   resubmit (via `buildEditableFields`). Logged as `REQUEST_EDITED`. **Needs this explicit
   body flag** (unlike #5 below, which infers from status alone) because SUPERADMIN can also
   satisfy #4's Procurement-edit check at the same `SUBMITTED` status — without the flag, a
   superadmin's full-form edit could silently fall into `buildProcurementPatch`'s narrow field
   whitelist (which reads `items_json`, not the form's `items` key) and lose everything outside
   payment/PO/item-amount fields. Any other status, or a non-owner/non-superadmin caller → 403
   `"Cannot edit — request is already being processed"`. See "Owner edit permission" below for
   the two UI entry points into this.
4. **Procurement inline edit** — only while `status` is `SUBMITTED` or `PO_UPLOADED`
   (Procurement's own actionable window). PROCUREMENT role or SUPERADMIN. Narrow field
   whitelist: per-item Net/VAT/WHT (via `items_json`, totals always recomputed server-side —
   never trusted from the client), `supplier_name`/`pay_method`/`bank_name`/`card_type`/
   `account_no`/`due_date`/`credit_term_days`/`slip_receiver_email`/`po_number`/`po_date`/
   `po_vendor`/`po_delivery_date`/`po_notes`/`files_json`. Everything else (department,
   expense type, category, etc.) is read-only from this path. Logged as `PROCUREMENT_EDIT`.
   Surfaced in `/procurement` via `RequestDetailModal`'s `editable` prop and `onSaveChanges`.
   **Entering a non-blank `po_number` while `status === "SUBMITTED"` (and no PO uploaded yet)
   auto-advances `status` to `PO_UPLOADED`** and stamps `po_uploaded_by`/`po_uploaded_at` —
   this is what replaced the old dedicated "Upload PO" modal; `PATCH /api/requests/[id]/po`
   still exists but nothing in the UI calls it anymore.
5. **Owner editing a REJECTED request without resubmitting** — only when
   `status === "REJECTED"`. Requester or SUPERADMIN. Full field set (same as resubmit/#3, via
   `buildEditableFields`), status unchanged. Logged as `REQUEST_EDITED`. This is the "Save
   Changes" button in the Edit & Resubmit modal above. No explicit flag needed: `REJECTED`
   never overlaps with #4's `SUBMITTED`/`PO_UPLOADED` gate, so there's no ambiguity to resolve.
6. **`{ edit_resubmit: true, ... }`** — the Edit Request approval workflow's resubmit step,
   only once an approver has granted the request (`lib/status.ts#isEditApproved`). See "Edit
   Request approval workflow" above for the full three-step flow this is the last step of.

A `BO_APPROVED`/`CEO_APPROVED`/`PAID` request is otherwise not editable through this endpoint
at all — those are exactly the three statuses the Edit Request workflow (#6) exists to unlock,
by first stepping the request to `EDIT_REQUESTED`. Any other status/role/body combination →
403.

### Owner edit permission (SUBMITTED, before Procurement)

`lib/status.ts#isOwnerEditable(r)` — `status === "SUBMITTED"` and `po_number`/
`po_uploaded_by`/`po_uploaded_at` are all empty. Once any of those three is set (which happens
atomically together — see `buildProcurementPatch`'s `autoUploadsPo`), the request is "in
Procurement's hands" and the owner can no longer freely edit it (they can still view it; if it
later gets rejected, the existing REJECTED-owner-edit path in `PATCH /api/requests/[id]`
applies instead — a separate, pre-existing capability, not this one).

**Two separate UI entry points reach the same `{ owner_edit: true }` PATCH**, both requested
explicitly rather than consolidated into one:
- **My Requests list** (`app/my/page.tsx`) — an Actions column on each row shows "✏️ Edit"
  (when `isOwnerEditable`) and/or "↩ Edit & Resubmit" (when `status === "REJECTED"`, existing).
  Both open the same `EditRequestModal` (renamed from the earlier REJECTED-only
  `EditResubmitModal` — same component, now branches its banner/submit-flags/secondary-action
  on `request.status` instead of assuming REJECTED). The Status column also gets a small grey
  label under the badge: "Editable" or "Pending Procurement" (`status === "SUBMITTED"` but not
  `isOwnerEditable`). **The spec called these "request cards"** — `/my` has always been a
  table, not a card grid (unlike `/bo-approvals`/`/ceo-approvals`, which genuinely are cards);
  rather than reshaping the page to match that wording, the Edit affordances were added to the
  existing table (a new Actions column + the grey label in the Status column), since a card
  layout wasn't otherwise in scope for this change.
- **`RequestDetailModal`** (opened by clicking any row) — a "✏️ Edit" button in the modal
  header (shown when `canOwnerEditNow`: the viewer is the requester or SUPERADMIN, and
  `isOwnerEditable`), which swaps the modal's entire body for an embedded `RequestForm`
  in-place (`fullEditMode` state) — pre-filled via the same shared `requestToFormInitial()`
  (now exported from `RequestForm.tsx` instead of living as a private copy in
  `app/my/page.tsx`, so both entry points build the same initial values). "Save Changes" is
  `RequestForm`'s own submit button; "Cancel" sits in the banner slot and just flips
  `fullEditMode` back off. The normal footer (Approve/Reject/Save Changes/etc.) is hidden
  while in this mode. A new `onOwnerSaved?` prop lets the parent page refresh its list after a
  successful save; `app/my/page.tsx` wires it to `load()`, other pages simply omit it since
  they don't realistically show a signed-in user their own `SUBMITTED`+no-PO request.

**Audit action naming:** the spec asked for `EDIT_REQUEST`/`RESUBMIT` action names, but every
existing "owner edited without resubmitting" path (the pre-existing REJECTED case) already
logs `REQUEST_EDITED`, and every resubmit already logs `RESUBMITTED` (see `lib/resubmit.ts`) —
introducing a second, differently-spelled name for the exact same concept would just fragment
the audit log for no added information, the same reasoning already applied to Procurement's
rejection action name earlier in this doc. Kept `REQUEST_EDITED`/`RESUBMITTED`.

### Accounting can reject (added)

`hasRole(user, "ACCOUNTING") && isAccountingActionable(existing)` was **missing** from
`POST /api/requests/[id]/reject`'s `canReject` check — Accounting previously could not reject
a `CEO_APPROVED` request at all despite the Accounting page existing. Added. `rejected_stage`
still stores the pre-rejection **status** (`"CEO_APPROVED"`), not a role name — this is
required for `resubmitTargetStatus` to work (it casts `rejected_stage` directly to a
`Status` value), and is the same convention every other stage's rejection already uses.

**Audit action naming for rejections is deliberately still just `"REJECTED"`** for every
role (Procurement/BO/CEO/Accounting alike) — a spec elsewhere asked for a
`PROCUREMENT_REJECT`-style action name specifically for Procurement's rejection, but every
existing reject path already logs the same generic `"REJECTED"` action (with `stage`/`reason`
in the detail), and forking a one-off name for just one role would break that consistency
without adding real information (the stage already says who was rejecting). Not implemented
as a special case; flag if a per-role audit action name is genuinely needed later.

### BO/CEO unapprove (built, not "fixed" — didn't exist before)

`app/api/requests/[id]/bo-unapprove/route.ts` and `.../ceo-unapprove/route.ts` are **new**. A
prior request asked to "fix unapprove logic in /api/approve/route.ts" as if it already
existed and just needed a permission restriction — there was no `/api/approve/route.ts` in
this codebase and no unapprove capability at all for BO or CEO (only Accounting's Mark
Paid/Unpaid toggle was reversible). Built from scratch. Reverts to the status the request was
in immediately before that approval — `requires_po ? "PO_UPLOADED" : "SUBMITTED"` for BO,
`skip_bo ? (requires_po ? "PO_UPLOADED" : "SUBMITTED") : "BO_APPROVED"` for CEO — clearing only
that stage's approver/approved_at. No Discord notification, matching the existing convention
that reversals don't notify (Accounting's Mark Unpaid doesn't either).

**Unapprove is scoped to the role, not to who personally approved it** (loosened from this
build's original approver-only restriction — a later spec explicitly asked for this, again
against a nonexistent `/api/approve/route.ts` file, same false-premise pattern as when this
capability was first built). Any BO whose scope (`bu_scope`/`dept_scope`/`cat_l1_scope`)
covers the request can unapprove it (`hasRole(user, "BO") && canBoActOnRequest(user,
existing)` — the same scope check every other BO action already uses, not a new concept), any
CEO can unapprove any `CEO_APPROVED` request (no scope concept exists for CEO anywhere else in
this schema, so none was invented here), and Accounting's existing Mark Paid/Unpaid toggle was
already unrestricted to begin with (no change needed there). SUPERADMIN can unapprove
anything, as before. `/bo-approvals` and `/ceo-approvals` both show "Approved by X" on the
relevant status's rows/cards and an Unapprove action (card + modal) gated by the same
role/scope rule client-side — real enforcement is server-side regardless.

### Request owner delete (SUBMITTED, before Procurement)

`DELETE /api/requests/[id]` — a hard delete, not a status change, for a request the owner
decided not to pursue after all. Gated to exactly the same window as `isOwnerEditable`/the
owner-edit path above: `status === "SUBMITTED"` and `po_number`/`po_uploaded_by`/
`po_uploaded_at` all still empty (requester or SUPERADMIN only). Nothing downstream
(BO/CEO/Accounting) has ever seen a request in this state, so there's no approval record to
preserve the way a `REJECTED` status keeps one — the `DELETE_REQUEST` audit_log row (written
before the delete, per the standard `requireUser → check → mutate → logAudit` order) is the
only remaining trace. My Requests shows a "🗑️ Delete" button next to "✏️ Edit" wherever
`isOwnerEditable` holds, opening a plain confirm modal ("Are you sure you want to delete
`EXP-...`? This cannot be undone.") before calling the route.

### Request Detail Modal (read view + optional inline edit)

`components/shared/RequestDetailModal.tsx` is the single shared "view everything about this
request" modal, used by all five list pages (My Requests, Procurement, BO Approvals, CEO
Approvals, Accounting) — clicking any row/card opens it. Sections: header (ID/status/BU/
submitted date), requester + basic info, Expense Items table with a computed totals row
(Net/VAT/WHT per item become inputs when `editable`; Cat L1/L2/Product Code/Description stay
read-only always), Payment Details (Supplier is a type-to-search combobox when `editable`,
same UX as `RequestForm`'s; Slip Receiver becomes a dropdown sourced from `/api/roles` when
`editable`), PO Information (only shown when `requires_po`; becomes 5 editable text inputs —
PO Number/Date/Vendor/Delivery Date/Notes — when `editable`, replacing the old separate
"Upload PO" modal entirely), Attachments (required-docs checklist same as `/submit`, file
list + open links, becomes an upload zone when `editable`), an Approval Timeline (`SUBMITTED
→ PO UPLOADED → BO APPROVED → CEO APPROVED → PAID`, each step computed from the existing
`isBoActionable`/`isCeoActionable`/`isAccountingActionable`/`needsProcurement` helpers in
`lib/status.ts` plus `skip_bo`/`requires_po` to mark steps `done`/`current`/`pending`/
`skipped`), a rejection banner when applicable, and an expandable rejection history when
`resubmit_count > 0`. Page-specific action buttons (Approve/Reject/Mark Paid/Edit & Resubmit)
are passed in via the `actions`/`footerExtra` props — the modal itself has no opinion on what
actions exist per page, only on how to *display* a request and, optionally, let Procurement
edit item amounts/rates, payment fields, PO details, and attachments inline (`editable` prop +
`onSaveChanges` callback → `ProcurementSavePatch`; heading reads "📋 Procurement Details"
instead of "Payment Details" while editable).

A second, separate edit mode exists alongside `editable`: `fullEditMode` (local state, no
prop) swaps the *entire* body for an embedded `RequestForm` — every section (Basic Info, PO
Required, Expense Items, Payment Details, Attachments), not just the narrow field set
`editable` exposes. Toggled by a "✏️ Edit" button in the modal header, shown only to the
request's own owner (or SUPERADMIN) while `lib/status.ts#isOwnerEditable` holds. See "Owner
edit permission" below.

**CEO signature banner/badges are unconditional now** (the earlier `showSignatureBadges` prop,
scoped to `/ceo-approvals` only, was removed — a later revision of the spec dropped that
page-scoping, so every page's modal shows the same thing): a banner at the top of the modal —
`background: #DBEAFE`, `border-left: 4px solid #3B82F6` — appears when
`ceo_signature_required` **and** `status` is `BO_APPROVED` or `PO_UPLOADED` (not just
"whenever signature-required", which would keep showing it long after it stopped being
actionable). Per-file badges in Attachments: green "✓ Signed" (`#D1FAE5`/`#065F46`) if the
filename includes `"SIGNED"` (covers both `_SIGNED` and bare `SIGNED` — the former is a
superstring of the latter, so one `.includes("SIGNED")` check covers both); orange "✍️ Needs
Signature" (`#FEF3C7`/`#92400E`) on a PO/Invoice-`doc_type` file **only if no file anywhere in
the request has a signed name** (`hasSignedFile` in `RequestDetailModal.tsx`) — signed files
can't be reliably attributed back to one specific original document (the PDF signing flow
below produces an unrelated generated filename), so signed-ness is tracked as one yes/no for
the whole request rather than per-file.

### PDF document signing (`pdfjs-dist` + `jsPDF`, replaced the earlier PNG-signature approach)

`components/shared/PDFSigner.tsx` replaces the first build's generic "✍️ Sign Document" button
(a standalone `SignaturePad.tsx` canvas that just attached a loose signature PNG, unrelated to
any specific file) with real, per-file PDF signing: the signature is drawn directly onto the
actual PDF page and re-exported as a new signed PDF. `components/shared/SignaturePad.tsx` was
deleted — nothing else used it once this replaced its only caller.

**Flow:** in `RequestDetailModal.tsx`'s Attachments file list, any file whose name ends in
`.pdf` gets an inline "✍️ Sign this PDF" button, gated by the same `signableAs` rule the old
button used (BO during `isBoActionable`, or CEO during `isCeoActionable` **and**
`ceo_signature_required`; SUPERADMIN counts as either — still no "BO signature required" flag
in this schema, same reasoning as before). Clicking opens `PDFSigner` inline below that file's
row (not a new page/modal):
1. Fetches the file as a blob first, then hands the bytes to `pdfjs-dist` — fetching as a blob
   rather than letting pdf.js do its own range-request fetching sidesteps CORS/partial-content
   issues on files served with restrictive headers (the spec's Drive-CORS concern; this app
   has no real Drive integration, but the same fetch-as-blob approach is strictly safer for
   any URL, including a Supabase Storage public URL). If the fetch or parse fails, shows "ไม่
   สามารถโหลด PDF ได้ กรุณาดาวน์โหลดและเซ็นแยก" with a direct download link, per spec.
2. Renders the current page to a `<canvas>` via pdf.js, with ◀ Page X of Y ▶ navigation.
3. A second, small (400×120) signature pad below it — own canvas, not a reuse of the deleted
   `SignaturePad.tsx` (different size and a fading "Draw your signature here" instruction text
   that component never had) — pen color `#1E1E1E` per spec.
4. Four corner buttons (default Bottom-Right) plus "Place Signature", which composites the
   drawn PNG onto the *preview* canvas at a 20px margin from the chosen corner and remembers
   that placement per page number (so navigating pages doesn't lose it, and different pages
   can each get their own placement). **Once placed, the signature is also draggable directly
   on the page preview** (mouse + touch) — added after the initial build, since a fixed corner
   alone often isn't exactly where a real PO/Invoice wants a signature. Position is stored as
   `{ xFrac, yFrac }` (fraction of canvas width/height, not raw pixels), so a drag on the 1.3×
   preview canvas lands in the identical relative spot on the 2× export canvas. Corner buttons
   still work after a drag — clicking one re-snaps the already-placed signature to that corner;
   clicking one before anything's placed just changes which corner "Place Signature" will use.
   Dragging hit-tests against the signature's own bounding box (`currentSignatureBox()`) so it
   doesn't interfere with page-navigation clicks elsewhere on the canvas. Redraws during a drag
   read from a cached plain-page raster (`pageRasterCacheRef`, captured once per page right
   after pdf.js renders it) rather than re-invoking pdf.js's async `page.render()` on every
   pointer-move — that would be both slower and would flicker.
5. "Save Signed PDF" re-renders every page at a higher raster scale (2×, vs. the 1.3× preview),
   composites each page's placement (if any), and rebuilds the file with `jsPDF` — one JPEG
   image per page, page geometry taken from pdf.js's `scale: 1` viewport (already in points,
   matching `jsPDF`'s `unit: "pt"`). The result uploads to Supabase Storage via
   `POST /api/storage/upload` (see below), and the new entry — `{ name:
   "<original>_SIGNED.pdf", url: <public Storage URL>, doc_type: "Signed Document" }` — is
   appended to `files_json` and saved through the existing `PATCH /api/requests/[id]` with
   `{ attach_signature: true, files_json }` branch (unchanged; only the caller changed). Like
   the PNG flow before it, `FileEntry` gained no `mimeType`/`id`/`type` fields for this — the
   spec's example included a `mimeType`, but PDF-ness is instead detected purely from the
   filename (`.pdf` suffix) both when deciding to show "Sign this PDF" and when the modal
   already covers "type" via `doc_type`, consistent with the same reconciliation made for the
   original PNG signatures.

**`pdfjs-dist` is pinned to the exact `3.11.174` in the spec's CDN worker URL**
(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`) rather than
whatever `npm install` would have resolved to (it resolved `^6.1.200` initially) — pdf.js hard
-errors at runtime if the installed API version and the loaded worker version don't match, so
leaving the version floating while hardcoding a specific worker URL would have been a
guaranteed break. `next.config.mjs` gained a `webpack.resolve.alias.canvas = false` — pdf.js
optionally `require()`s the native `canvas` package as a Node-side fallback that's never
installed (and never needed; this app only ever calls pdf.js from the browser), and without
the alias the production build fails trying to resolve it.

**Signed PDFs are stored in real Supabase Storage, not base64** — a deliberate change from the
base64-everywhere convention used for every other attachment in this app (Submit files,
Procurement attachments, Announcement images) and from the first signature build's own PNG
approach. The earlier build chose base64 because the spec only said "prefer Storage if
available" (ambiguous); this spec is unambiguous — it names the bucket, the upload endpoint
contract, and `supabase.storage.from(bucket).upload(...)` explicitly — so this build follows
it rather than forcing consistency with the older, more equivocal decision. The `signed-
documents` bucket was created live via the Storage REST API (public, 10MB limit,
`application/pdf` only — no Supabase CLI/dashboard access in this environment, same constraint
as every DDL change in this project; see "Database Schema" below). `POST
/api/storage/upload` accepts `FormData` (`file`/`filename`/`bucket`), uploads via the service-
role admin client, and returns `{ url, path }`; it allowlists `bucket` to just
`"signed-documents"` (this route is generic by shape per spec, but only `PDFSigner.tsx` calls
it, so an open allowlist would just be an unnecessary arbitrary-storage-write hole) and
requires the caller to hold BO, CEO, or SUPERADMIN — the same roles the Sign flow is gated to
client-side.

### Better error messages (`lib/api-helpers.ts#handleApiError`)

Every route's unhandled-error path now surfaces a Postgrest error's `code`/`details`/`hint` in
the JSON response, not just `.message` — per `@supabase/postgrest-js`'s own doc comment on
`PostgrestError`, `hint` is usually the single most useful field (e.g. the literal `GRANT`
statement to fix a permissions error), and was previously discarded. This was investigated
while chasing a reported "Internal Server Error" on Procurement saves — the live `requests`
table, roles, and column set were all verified correct via the service-role REST API (couldn't
get a real repro without a browser session/OAuth in this environment), so the exact original
failure wasn't pinned down, but this fix means the next occurrence will self-diagnose in the
UI instead of showing a generic message.

**`handleApiError` also rethrows Next.js's own `DYNAMIC_SERVER_USAGE` error instead of treating
it as an application error.** Every route in this app is auth-gated via `cookies()`, so
`next build`'s static-generation pass hits this internally-thrown, expected signal for every
single route — before this check existed, this file's blanket `try { ... } catch (err) {
return handleApiError(err) }` pattern in every route caught it too, logging a scary-looking
"Unhandled API error" stack trace (and a throwaway 500 JSON body nothing ever reads) once per
route, per build. The final build output was always correct regardless (Next tracks "a dynamic
API was accessed" via a side effect when `cookies()`/`headers()` is called, not solely via the
exception propagating uncaught, so catching-and-swallowing it never actually broke the route's
dynamic/static classification) — but it made `npm run build`'s output look like it was failing
six-plus times over when it wasn't. Rethrowing (detected via `err.digest ===
"DYNAMIC_SERVER_USAGE"`) lets Next's own machinery handle it silently, same as it would if this
file didn't wrap every route in a catch-all.

### Required field indicators

`components/shared/RequiredMark.tsx` — one red `*` (`#DC2626`), used after every genuinely
required field's label across `RequestForm.tsx`, the Procurement PO Number field in
`RequestDetailModal.tsx`, and the Settings modals (Supplier Name, User Email, Product Name,
Category BU/Department, dept_config Department, Announcement Title). A "Fields marked * are
required" note sits above the Save/Submit buttons on every form/modal that has one. **Due
Date on `/submit` is now actually enforced as required** (it wasn't before) — marking a field
required visually without enforcing it would just be a UI lie, so `RequestForm.tsx#validate()`
gained a check for it (only when the field is actually visible: Payment Details shown and
`hideDueDate` not set). PO Number in the Procurement panel is enforced contextually — only
required if you've started filling in other PO fields (Date/Vendor/Delivery/Notes) without it.

**`skip_ceo`** exists as a `dept_config` column per the original schema spec, but the
documented flow variants only ever mention `skip_bo`. This build stores `skip_ceo` on
`dept_config` and copies it onto each request at submission, but **does not yet wire it into
the status flow** — no documented behavior existed to implement it against. If skip_ceo should
behave symmetrically to skip_bo (jump straight to `PAID` after the BO/PO stage), that logic
needs to be added to `lib/status.ts` and the relevant API routes.

### CEO Signature Logic
- `ceo_signature_required = TRUE` and `exceed_amount > 0` → sign only if `total > exceed_amount`
- `ceo_signature_required = TRUE` and `exceed_amount = 0` → always sign
- `ceo_signature_required = FALSE` → never sign

Implemented in `lib/permissions.ts#computeCeoSignatureRequired`. Per the spec this is "called
at BO approval time" — this build computes it once at submission (`POST /api/requests`) and
recomputes it at BO-approval (`PATCH /api/requests/[id]/bo-approve`) and, defensively, at
CEO-approval if still unset. Since `dept_config` and the request total don't change between
submission and BO approval in the normal flow, computing it at submission is functionally
equivalent to computing it "at BO approval time," just simpler — flag if this assumption
doesn't hold (e.g. if `dept_config` is expected to be editable mid-flight).

### DeptConfig Matching (score-based)
```
exact dept + exact BU + exact cat_l1   = 35
exact dept + exact BU + wildcard cat   = 25
exact dept + wildcard BU + wildcard cat = 15
wildcard dept (fallback row, dept='*') = -5
```
Implemented in `lib/permissions.ts#scoreDeptConfig` / `matchDeptConfig` as a general formula
(dept exact match = 15 pts, +10 per exact BU/cat_l1 match) that reproduces the three
documented combinations and extrapolates the untested fourth (exact dept + wildcard BU +
exact cat_l1 = 25) consistently.

### BO Scope Filtering
A BO sees/can act on a request only if **all** of the following match one of their `roles`
rows: `bu_scope` matches `request.bu`, `dept_scope` matches `request.department`, `cat_l1_scope`
matches `request.cat_l1` (each either `*` or a comma-separated list containing the value).

---

## Expense Types

Thai labels are exact strings from the legacy system (`lib/constants.ts` → `EXPENSE_TYPES`) —
**do not alter them**. This list superseded an earlier, shorter list (kept in sync here after
the expense type set was expanded):

- เบิกค่าใช้จ่ายทั่วไปตามรอบบัญชี (Deposit-จ่ายก่อนรับของ)
- เบิกค่าใช้จ่ายทั่วไปตามรอบบัญชี (Credit-รับของก่อนจ่าย) — shows the Credit Term (days) field
  (hidden for every other type). Required docs: PO, Invoice, ใบส่งของจาก Supplier, ใบรับของ
  จากระบบ AccCloud — **ใบกำกับภาษี (Tax Invoice) was deliberately removed** from this list
  (Credit-type documents arrive before the tax invoice is issued). Also the only type that
  shows the orange documents-deadline banner (`creditDeadlineMessage()` in
  `components/shared/RequestForm.tsx`) — "N days left" / past-due, counting down to the 15th
  of the current month — and the only type the `/api/cron/document-reminder` cron job
  targets (10th & 14th of the month; see Notifications below).
- เบิกค่าใช้จ่ายที่ชำระแล้ว (ตัดบัตรเครดิต, wallet, อื่นๆ) — hides the Due Date field
- เบิกเงินทดรองจ่าย (Advance Payment)
- เบิกเงินสดย่อย (Petty cash)
- เบิกสำหรับส่งเสริมการขาย (e.g. KOL/Influencer, แจกสินค้า) — hides bank/card/pay-ref fields
- เบิกสำหรับ Product Tester/Display (เบิกใช้ภายใน คิดงบจากต้นทุนสินค้า) — hides the entire
  payment section
- เบิกด่วน (Urgent Payment) — requires `urgent_reason`

The Deposit, Credit, and "ชำระแล้ว" (already-paid) types also drive the **required documents
checklist** shown in the /submit Attachments section (`EXPENSE_TYPES[].requiredDocs`, mode
`"all"` or `"any"` — e.g. "ชำระแล้ว" only requires Invoice *or* ใบกำกับภาษี, not both). The
same checklist is shown again in `RequestDetailModal` (all pages, not just /submit). The
checklist is informational only — it is not enforced as a hard submit-blocking validation,
since that wasn't specified.

**`requires_po` default-per-type is an inferred convenience default, not a hard rule** — the
spec doesn't define which expense types need a PO. `lib/constants.ts#EXPENSE_TYPES[].
defaultRequiresPo` defaults Petty Cash, "ชำระแล้ว", and Product Tester/Display to `false` and
everything else to `true`, but `/submit`'s PO-required section is two selectable cards (not a
checkbox) so the submitter has the final say regardless of the default. Adjust the defaults in
`lib/constants.ts` if wrong.

---

## Multi-Item Requests

A request can bundle several line items (`items_json` on `requests`). `lib/totals.ts#
computeTotals` sums `amount_net`/`vat_amount`/`wht_amount`/`total` across items for the
flat top-level columns, and reports the top-level `vat_rate`/`wht_rate` as the shared rate
if every item uses the same rate, or `0` ("mixed") otherwise — the per-item rates in
`items_json` are authoritative when rates differ. `items_summary` is the item description
list; `items_count` is `items_json.length`. Net amount is **optional per item** — Procurement
fills it in when uploading the PO if the submitter left it blank; `cat_l1`/`description` are
the only required fields per item, enforced client-side on `/submit`.

Each item also carries its own `cat_l1`/`cat_l2`/`product_code` (`RequestItem` in
`types/database.ts`) — the Expense Items table on `/submit` scopes Category L1/L2 per row, fed
by the same `/api/categories` reference data as before. There is no longer a standalone
top-level Category L1/L2 picker on the form. The flat `requests.cat_l1`/`cat_l2` columns
(used by `dept_config` matching and BO scope filtering) are populated from **the first item**
when a multi-item request has items in different categories — an inferred convenience
consistent with the existing mixed-rate handling above; flag if per-item dept_config/BO-scope
routing is ever needed instead.

**Per-item Branch/Product (Retail or R&D + Expense Type = เบิกเงินสดย่อย (Petty cash) only):**
`RequestItem` carries an optional `product` field for exactly these two combinations — every
other Retail/R&D request still uses the single top-level `requests.product` field (see
"Settings & Reference Data" below for how that's fed). `RequestForm.tsx#perItemFieldMode`
(`"branch" | "product" | null`) gates both sides of the swap for whichever department applies:
- **Retail + Petty cash** → the top-level "Branch (optional)" field is hidden; a **required**
  "Branch" column (with `RequiredMark`) appears in the Expense Items table.
- **R&D + Petty cash** → the top-level "Product (optional)" field is hidden; an **optional**
  "Product" column appears instead — same table position, no red asterisk.
- Every other Department/Expense Type combination is unaffected (including Retail/R&D with any
  *other* expense type, which keep their existing top-level field, and every department besides
  Retail/R&D, which never had a product/branch field to begin with).

Column position: after Category L2, before Product Code, one dropdown per row (so a single
Petty Cash request can span several branches/products). On submit, the top-level `product`
field is explicitly sent as `undefined` whenever `perItemFieldMode` is set (not whatever stale
value the state happened to hold from a previous department) — the value lives per-item
instead. `RequestDetailModal.tsx` shows the same column, read-only, whenever any item in
`items_json` actually has a `product` (`hasItemProductColumn`), header labeled via the existing
`branchLabel` (Retail → "Branch", R&D → "Product") — so it doesn't affect any other department's
table, and empty per-item values there render as "—" (em dash, per spec) rather than the "-"
every other empty cell in that table uses. The tfoot "Totals" row's `colSpan` adjusts
accordingly.

**This field was renamed from `branch` to `product`** (was added as `branch`-only, Retail-only,
in the prior turn) — this turn's spec explicitly reads `items_json[].product` in
`RequestDetailModal`'s update instructions and generalizes the same slot to also hold an R&D
product value, so one shared field name resolved the earlier ambiguity between the spec's
"store in the item's existing product field" line and its "branch_or_product" `items_json`
shape example — both turned out to mean the same single field, now named to match.

**Per-item options are sourced from the `products` table** (`productOptionsFor`), the same
helper the top-level Branch/Product fields already use — **not** `categories.product`. A spec
this turn explicitly asked for `categories.product` instead (named the exact query shape
twice), and that was tried first, but it broke in practice: the live `categories` table has
**zero** rows with a non-empty `product` value for either Retail or R&D (confirmed via a direct
REST query — `curl .../categories?select=department,product` — all 24 Retail rows and all 20
R&D rows have `product: null`), so the per-item dropdown rendered with no selectable options at
all. The `products` table, by contrast, already has real data for both (`Song Wat`/`Talat
Noi`/etc. for Retail, three SKUs for R&D) — it's what the working top-level fields use. Given
the literal-spec source was empty in the live database and the alternative already had the
right data and a proven-working consumer, this was switched to `productOptionsFor` rather than
asking someone to backfill `categories.product` first. This also resolves the inconsistency
flagged when the categories-sourced version first shipped: the per-item and top-level dropdowns
for the same department now read from the same table again.

---

## Settings & Reference Data

`/settings` manages six tabs, each independently role-gated (see "Settings tab permissions"
below) — no longer SUPERADMIN-only for the page itself, though SUPERADMIN can still see and
edit every tab. The first four are reference tables that feed pickers elsewhere in the app;
the last two (CEO Signature Rules, Announcements) are admin-only configuration with no
submit-form picker counterpart:

- **Suppliers** (`suppliers` table, `/api/suppliers`) — the `/submit` Supplier/Payee dropdown
  selects by `name` (there's no `supplier_id` FK on `requests`, consistent with the existing
  free-text `supplier_name` column) and auto-fills Payment Method/Bank Name/Account No from
  the matching row on selection.
- **Products/SKUs** (`products` table, `/api/products`) — feeds the Product Code field on each
  Expense Item row. The spec calls this both a "text input" (Expense Items) and something the
  products table "feeds" as a dropdown (Settings) — reconciled as a **text input with a
  `<datalist>`** of known SKU codes, satisfying both without contradiction. Each item also has
  a "No code yet" checkbox (`RequestItem.product_code === null` when checked).

  The Basic Info **Product** field (Department = R&D) and **Branch** field (Department =
  Retail) are also fed by this same `products` table — a genuine dropdown this time, filtered
  client-side to `products` where `department` matches ("R&D" or "Retail") and `bu` matches
  the request's BU (or is unset, treated as applicable to any BU). There is **no separate
  branches table** — a Retail "branch" is just a `products` row with `department = 'Retail'`
  and `product_name` holding the branch name; `sku_code` is left blank for these rows. This
  was an explicit user decision (reuse Product/SKU Management rather than add a dedicated
  Branch Management tab) to avoid a second near-identical table/tab/API. Both fields still
  write to the single `requests.product` column, same as before — except Retail/R&D + Petty
  cash, which move Branch/Product to a per-item field instead (see "Multi-Item Requests"
  above); unlike these top-level fields, the per-item version sources its dropdown options
  from `categories.product`, not this `products` table — see "Multi-Item Requests" for why.
- **Users/roles** (existing `roles` table, new `/api/roles` CRUD) — Settings > User Management
  edits `roles` rows directly (multi-role users still show as multiple rows, per the existing
  multi-role model above). The same endpoint backs `/submit`'s Slip Payment Receiver dropdown.
  **The `roles` table has no `name` column**, so that dropdown lists email addresses only, not
  "name + email" as literally specified — there's no stored display name to show per role row.
  Revisit if a name column gets added.
- **Categories** (existing `categories` table, `/api/categories` extended with POST/PATCH/
  DELETE alongside the original GET, plus `/api/categories/[id]` for PATCH/DELETE) — Settings
  > Category L1/L2 Management edits the same table that feeds the per-item Cat L1/Cat L2
  pickers on `/submit`. `GET` takes optional `?bu=&dept=` filters. `POST /api/categories`
  accepts either a single row `{bu, department, cat_l1?, cat_l2?, product?}` or
  `{ bulk: true, rows: [...] }` for bulk import. The Settings bulk-import modal takes a `.csv`
  file upload (read via `file.text()`, BOM-stripped, simple comma-split — no quoted-field
  escaping), shows a preview table of every parsed row before importing, and only posts on
  explicit confirm. **Bulk import is duplicate-safe**: the route fetches every existing
  `(bu, department, cat_l1, cat_l2)` combination once up front (there's no DB unique
  constraint on `categories` to upsert against), filters incoming rows down to combinations
  not already present — also deduping within the uploaded batch itself — and inserts only
  the new ones in one batch. `product` is deliberately excluded from the dedup key. Re-
  uploading the same file is always a no-op on the second pass; the response reports
  `inserted` / `skipped` (already existed) / `invalid` (missing `bu` or `department`)
  separately, surfaced in the UI as "X inserted, Y skipped (already existed)".

  `categories.bu` and `categories.department` both support `'*'` as a wildcard ("applies to
  every BU/department"), same convention as `dept_config`/BO role scopes — honored in the
  Cat L1/L2 filtering (`catL1Options`/`catL2OptionsFor` in `components/shared/RequestForm.tsx`,
  shared by `/submit` and My Requests' edit form). (A prior data issue — some seed rows had
  the department abbreviation baked into `department` itself, e.g. `"Marketing (MKT)"` instead
  of `"Marketing"` — was cleaned up live via the service-role REST API; all `department`
  values now match `DEPARTMENTS` exactly.)
- **CEO Signature Rules** (existing `dept_config` table, `/api/dept-config` extended with
  POST alongside the original GET, plus `/api/dept-config/[id]` for PATCH/DELETE) — Settings
  > CEO Signature Rules edits the same table that drives `skip_bo`/`skip_ceo`/CEO-signature
  matching (see "DeptConfig Matching" above). Unlike suppliers/products/categories, **this
  endpoint stays restricted for GET too** (now SUPERADMIN + CEO, was SUPERADMIN-only) —
  exposing approval thresholds and BO emails more broadly would leak sensitive approval-routing
  rules to regular staff, unlike the other reference tables which are harmless to read. CEO
  needs GET now too, not just the mutation verbs, since the tab has to actually load the
  existing rules before a CEO can edit them.
- **Announcements** (`announcements` table, `/api/announcements` + `/api/announcements/[id]`)
  — Settings > Announcements manages the homepage's pinned/unpinned announcement feed. `GET`
  defaults to active-only, pinned-first; `?all=1` (SUPERADMIN + CEO) also returns inactive rows
  for the management table. Deleting is a hard delete; "Deactivate" (`is_active: false` via
  PATCH) is the soft alternative, used to retire an announcement without losing its history.

  **`supabase/migrations/008_announcements.sql`** is a self-contained, idempotent
  (`CREATE TABLE IF NOT EXISTS`) migration superseding the still-unapplied
  `005_homepage_settings.sql` + `006_announcement_attachments.sql` pair — written this way
  rather than as a third file layered on top of two nobody has run yet, to avoid genuine
  redundancy. `GET /api/announcements` also catches Postgrest's `PGRST205` ("table not found
  in schema cache") and returns `{ announcements: [] }` instead of a 500, so the homepage and
  Settings tab degrade gracefully (empty list, not an error) until this migration is actually
  applied.

  **Attachments now go to a real Supabase Storage bucket (`announcements`, public, 2MB limit,
  image/pdf mime types) instead of base64** — a later spec explicitly asked for real Storage
  here (the base64-in-JSONB pattern used everywhere else in this app was an earlier explicit
  choice, not a default, so this doesn't contradict it). `POST /api/storage/upload` was
  generalized from a single hardcoded bucket to a `BUCKET_ROLES: Record<string, Role[]>`
  allowlist (`signed-documents` → BO/CEO/SUPERADMIN, `announcements` → SUPERADMIN/CEO) so both
  buckets share one upload route. Buckets themselves are created via the Storage REST API
  (works without `SUPABASE_ACCESS_TOKEN` — it isn't DDL, unlike the `announcements` table
  itself). Settings > Announcements shows a real image preview and disables Save while
  uploading. `attachment_url` now holds a Storage URL, not a data URL; `attachment_type` is
  unchanged.

**Mutation permissions** (POST/PATCH/DELETE) per table, since a later spec scoped these
per-role instead of SUPERADMIN-only everywhere: Suppliers → SUPERADMIN/ACCOUNTING/PROCUREMENT;
Products → SUPERADMIN/PROCUREMENT; Categories → SUPERADMIN only (unchanged); dept_config →
SUPERADMIN/CEO; Announcements → SUPERADMIN/CEO; roles (Users tab) → SUPERADMIN only
(unchanged). **GET stays open to every signed-in user for suppliers, products, categories, and
roles regardless of the mutation scoping above** — the literal spec for this batch said to
restrict GET on all four to the same narrower role sets as their mutations, but that would have
broken `/submit`'s Supplier/Payee picker, Product Code picker, Cat L1/L2 pickers, and Slip
Payment Receiver dropdown for every ordinary EMPLOYEE (all four already fed those pickers for
every signed-in user before this batch, and nothing in the spec asked to take that away).
Applied literally only where GET was already restricted before this batch (`dept_config` — see
above — and `announcements`'s `?all=1`), where widening it, not narrowing it, was what was
actually asked for.

### Settings tab permissions

Which of the six tabs a given role sees, in addition to page-level access (any role except a
pure `EMPLOYEE` — see "Roles & Permissions" above):

| Tab | Roles allowed (SUPERADMIN always included) |
|---|---|
| Supplier Management | ACCOUNTING, PROCUREMENT |
| User Management | *(SUPERADMIN only)* |
| Product/SKU Management | PROCUREMENT |
| Category L1/L2 Management | *(SUPERADMIN only)* |
| CEO Signature Rules | CEO |
| Announcements | CEO |

`lib/permissions.ts#SETTINGS_TAB_ROLES`/`canAccessSettingsTab`/`firstAccessibleSettingsTab` are
the single source of truth for this — `settingsClient.tsx`'s tab bar filters against it
client-side, and every corresponding API route enforces the same roles server-side (the actual
boundary; see "Mutation permissions" above). **A BO-only user passes the page-level check
(BO ≠ EMPLOYEE) but matches zero tabs in the table above** — BO isn't listed anywhere in it, so
Settings shows up in their nav but leads to an empty state ("You don't have access to any
Settings section..."). This is a direct, literal consequence of the spec's own two rules taken
together ("visible to all roles except EMPLOYEE" + the tab table above never mentioning BO) —
flagged here rather than quietly special-cased, in case a BO-reachable tab was actually
intended and just missing from the table.

**Tab URLs**: `/settings?tab=<key>` — reading the initial tab from the URL, and rewriting the
URL on every tab switch, uses the browser's History API directly (`window.history.replaceState`)
rather than `next/navigation`'s router. A router-driven update would re-run the server-side
`page.tsx` guard (a full round trip) on every single tab click for no benefit; all that's
actually needed is for the address bar to reflect the current tab (bookmarking, sharing,
back-button) and for a direct link to an unauthorized tab to redirect to the first tab the
visitor can actually access (`firstAccessibleSettingsTab`) — both achieved without a Next.js
navigation. `useSearchParams()` (needed to read `?tab=` on first load) requires a Suspense
boundary in the App Router; `SettingsClient` is a thin wrapper providing one around the actual
`SettingsClientInner`.

### Department picker (dynamic, not hardcoded)

`/submit`'s Department dropdown no longer reads `DEPARTMENTS` directly — it fetches
`GET /api/departments`, which returns the **distinct `department` values currently present
in `categories`** (deduped/sorted in application code; Supabase JS has no native `SELECT
DISTINCT`), excluding the `'*'` wildcard sentinel. The dropdown shows "Loading..." (disabled)
until that resolves, and falls back to the hardcoded `DEPARTMENTS` list if the fetch fails
*or* returns an empty array (an empty result is itself a degraded state worth falling back
from, not just a network failure — see `app/submit/page.tsx`). `department` starts blank and
is defaulted to the first loaded option once available, so the visible default department can
change if Settings > Category L1/L2 Management data changes, unlike the previous fixed
`DEPARTMENTS[0]` ("Marketing") default.

**This couples Department-picker availability to category data, by design** — if a
department has zero rows in `categories`, it disappears from `/submit` entirely (no
department-only mode) until someone adds at least one category row for it in Settings. As of
this writing `categories` has rows for 9 of the 13 canonical departments; **Store Investment,
People & HR & System, Lab Instrument Investment, and COG have zero rows** and are therefore
currently **not selectable on `/submit`**, even though the DB `bu` check constraint doesn't
scope them out (they're only blocked by having no categories). Add at least one category row
per missing department in Settings if they need to remain submittable.

Only `/submit`'s Department field uses this dynamic list. The My Requests edit-and-resubmit
modal (`app/my/page.tsx`) still uses the hardcoded `DEPARTMENTS` — not converted, since it
wasn't in scope for this change and a rejected request being edited already has a concrete,
previously-valid department. BO Approvals (`app/bo-approvals/boapprovalsClient.tsx`) has no
hardcoded department list to convert — it only ever displays `request.department`, the
already-persisted value on each request, never a picker or a decoded `dept_scope`.

## Database Schema

See `supabase/migrations/001_initial_schema.sql` for the full DDL: `requests`, `roles`,
`dept_config`, `categories`, `audit_log`, `budget_2026`, `revenue`, plus `request_id_seq` /
`generate_request_id()` backing the `EXP-YYYY-MM-NNNNNN` ID format (atomic per-month counter).
`supabase/migrations/004_new_features.sql` (**applied** — `suppliers`/`products`/`categories`
all have live data as of this writing) adds `suppliers` and `products` (feeding Settings and
the Supplier/Payee and Product Code pickers), `requests.account_no` and
`requests.slip_receiver_email`, and rewrites the `requests.status` CHECK constraint to drop
`'EXPIRED'`. `supabase/migrations/005_homepage_settings.sql` and
`006_announcement_attachments.sql` originally added `announcements` (+ seed row) and its
`attachment_url`/`attachment_type` columns — **both are now superseded by
`008_announcements.sql`** (see "Settings & Reference Data" above), a single self-contained,
idempotent migration that creates the same end state; only 008 needs to be applied, not all
three. `supabase/migrations/007_roles_update.sql` adds `roles.is_auto_registered` (see
"Auto-registration for new @mimetta.co users" above) — numbered 007, not 006 as originally
requested, since 006 was already taken this session by `006_announcement_attachments.sql`.
`supabase/migrations/009_edit_request.sql` adds the five `edit_*`/`status_before_edit` columns
and the `EDIT_REQUESTED` status (see "Edit Request approval workflow" above).

**Migrations 007, 008, and 009 have not been applied to the live database as of this
writing** (confirmed live via direct REST queries — `GET .../announcements` 404s with
`PGRST205`; `GET .../roles?select=is_auto_registered` 42703s "column does not exist") — same
constraint as before, the agent environment has no `SUPABASE_ACCESS_TOKEN`/linked project
(`supabase login`/`db push` both fail), only the DML-capable service-role REST key. Apply all
three manually (Supabase SQL editor, or `supabase db push` with real credentials).

**Unlike 005/006, shipping 007 unapplied does not break anything** — `lib/auth.ts#getCurrentUser`,
`GET /api/roles`, and `PATCH /api/roles/[id]` all catch Postgrest's `42703` ("column does not
exist") specifically and fall back to the pre-007 column set, so sign-in and role management
keep working exactly as before this batch. Auto-registration, the yellow "not yet assigned"
banner, and the User Management "New" badge/Pending Users section simply stay inactive (no
errors, just absent) until 007 is actually applied — at which point they activate automatically
the next time each of those falls through to the primary (non-fallback) query path, with no
further code changes needed. This was deliberate: this batch's code depends on a schema change
this environment cannot apply itself, and Vercel auto-deploys from every push (per this batch's
own instructions) — shipping code that hard-required the new column, with no way to guarantee
which lands first (the deploy or someone manually running the migration), would have meant a
real window where every sign-in in production 500s.

**Access model:** every table has RLS enabled with no policies granted to `anon`/
`authenticated` — default deny. All application reads/writes go through Next.js API routes
using the service-role key (`lib/supabase/admin.ts`), which bypasses RLS. Permission and
BO-scope logic lives entirely in the application layer (`lib/permissions.ts`), not in SQL —
this keeps the score-based dept_config matching and comma-separated scope lists in one place
instead of duplicated between JS and Postgres policies.

`budget_2026` has no `year` column — the table is single-year by design (the year is in the
table name). `revenue` does have an explicit `year` column. **Assumption:** the dashboard
matches `revenue.month` against `budget_2026`'s `jan`..`dec` column keys by lowercasing and
taking the first 3 characters (`app/dashboard/dashboardClient.tsx`) — if the migrated
`revenue.month` data uses a different convention (e.g. `"01"` or full month names), update
that mapping.

"Actual" spend on the dashboard is defined as **`PAID` requests only** (money that has
actually left the company), not all non-rejected requests — this wasn't specified and is the
more conservative reading. See `app/api/dashboard/budget/route.ts`.

---

## Pages

| Route | Notes |
|---|---|
| `/` | Homepage (was a plain redirect to `/submit`; now a real page, and now the de facto dashboard — see "Dashboard nav removal" below). Announcements, Quick Stats, Payment Calendar — see "Homepage" below. Every signed-in user has access. |
| `/submit` | Multi-item expense form (`components/shared/RequestForm.tsx` in create mode). Every signed-in user has access. |
| `/my` | Table (not cards). Actions column: "✏️ Edit" when `isOwnerEditable` (SUBMITTED, no PO activity yet), "🗑️ Delete" in the same window (see "Request owner delete" below), "↩ Edit & Resubmit" when REJECTED, "✏️ Request Edit" when `canRequestEdit` (BO_APPROVED/CEO_APPROVED/PAID, no edit request pending yet), "↩ Edit & Resubmit" again when `isEditApproved` — see "Edit Request approval workflow" above. Status column shows a grey "Editable"/"Pending Procurement"/"Edit requested — awaiting approval"/"Edit approved — resubmit" sublabel. Row click still opens `RequestDetailModal` (read-only by default), which now also gets its own in-place "✏️ Edit" header button for the SUBMITTED case (see "Owner edit permission" below) — a second, separate entry point to the same edit capability. |
| `/procurement` | Row click opens `RequestDetailModal` in editable mode — items (Net/VAT/WHT), payment fields, attachments, and PO Details are all inline-editable; no separate "Upload PO" modal anymore. Tabs: Pending PO / PO Uploaded / All. |
| `/bo-approvals` | Row click opens `RequestDetailModal` with Approve/Reject in the footer, or **Unapprove** on `BO_APPROVED` rows (any in-scope BO, or SUPERADMIN — see "BO/CEO unapprove" above). Cards show "Approved by X" on `BO_APPROVED` rows. BU filter, skip-BO badges, CEO-signature-required badges. Tabs: Pending / **Edit Requests (N)** (new) / All. |
| `/ceo-approvals` | Row click opens `RequestDetailModal` — same Approve/Reject/**Unapprove** pattern as BO Approvals, any CEO (or SUPERADMIN) can act. Signed/needs-signature file badges + a signature-required banner are unconditional now (see "Request Detail Modal" below), not scoped to this page anymore. Tabs: Pending / Needs Signature / **Edit Requests (N)** (new) / All. |
| `/accounting` | Row click opens `RequestDetailModal` with Mark Paid/Unpaid + **Reject** (added — see "Rejection & Resubmit"). Shows a Slip Receiver column. Tabs: Awaiting Payment / Paid / **Edit Requests (N)** (new). |
| `/dashboard` | **No longer in the nav** (see "Dashboard nav removal" below) — the homepage now serves as the dashboard. The route itself still exists and redirects to `/` unconditionally, in case anything still links there directly; `dashboardClient.tsx` and its API routes are left in place, unreferenced. |
| `/settings` | Any role except a pure EMPLOYEE (was SUPERADMIN only). Six tabs, each independently role-gated — see "Settings tab permissions" below; SUPERADMIN sees all six. User Management gets a "New (X)" badge + Pending Users section for auto-registered accounts awaiting a real role. |

Each role-gated page (`procurement`, `bo-approvals`, `ceo-approvals`, `accounting`,
`dashboard`, `settings`) is a thin server component (`page.tsx`) that checks `canAccessPage`
and redirects, wrapping a `"use client"` component (`*Client.tsx`) that does the data fetching
and interaction. `/`, `/submit`, and `/my` skip the `canAccessPage` wrapper since every
signed-in user has access to all three (`/` and `/my` still redirect to `/login` if there's no
session at all).

### Dashboard nav removal

`components/Nav.tsx`'s `LINKS` array no longer includes a Dashboard entry — the homepage (`/`)
already surfaces Announcements/Quick Stats/Payment Calendar (see "Homepage" below) and was
judged to make a separate nav-level Dashboard link redundant. The `/dashboard` route itself
(`dashboardClient.tsx`, budget-vs-actual/monthly-trend/revenue-overlay charts, and its backing
`/api/dashboard/*` routes) is **not deleted** — `app/dashboard/page.tsx` was rewritten to an
unconditional `redirect("/")` instead, so any bookmarked or hardcoded link still lands
somewhere sensible rather than 404ing, while the nav item and the standalone page experience
are both gone. `app/api/dashboard/home-stats/route.ts`'s `approvalLink` fallback sentinel
changed from `"/dashboard"` to `"/"` to match.

`/my`, `/procurement`, `/bo-approvals`, `/ceo-approvals`, and `/accounting` all render a
`<FilterBar>` (`components/FilterBar.tsx`) below their tab navigation — month/status/category/
expense-type/payment-method/supplier filters applied **client-side** to the already-loaded
request list (no extra API calls). Each page passes its own relevant `statuses` subset.
Collapsed behind a "🔽 Filters" toggle button (with an active-count badge, e.g. "Filters (3)")
by default rather than always-visible — see "UI Design System" below.

CEO rejection-history visibility is scoped per the spec — `lib/permissions.ts#
visibleRejectionHistory` filters `rejection_history` so a CEO viewer only sees entries they
personally authored at the `CEO_APPROVED` stage; rejections from other stages remain visible
to everyone who can see the request.

### Homepage (`/`, `app/homeClient.tsx`)

- **Announcements** — `GET /api/announcements` (active + pinned-first, then newest). Managed
  from Settings > Announcements (SUPERADMIN); `?all=1` there also returns inactive rows.
- **Quick Stats** — `GET /api/dashboard/home-stats`: "My Pending Requests" (own requests not
  `PAID`/`REJECTED`), "Pending My Approval" (sum across whichever of BO/CEO/ACCOUNTING roles
  the user holds — **Procurement deliberately excluded**, per the stat's own naming; SUPERADMIN
  counts as holding all three), "Paid This Month" (sum of `total` for `PAID` requests with
  `paid_at` in the current calendar month — not scoped per-user, an org-wide figure). The
  approval-stat card links to whichever of `/bo-approvals` → `/ceo-approvals` → `/accounting`
  the user actually has access to (first match, in that priority order) and only renders at
  all if at least one applies.
- **Payment Calendar** — `GET /api/dashboard/payment-calendar`: requests with `due_date` in
  the current calendar month. **Excludes both `PAID` and `REJECTED`** — the spec said "not yet
  PAID", but a `REJECTED` request will never be paid unless resubmitted (at which point it's
  live again with a fresh due date), so including dead rejected requests in a forward-looking
  "what's coming due" view would just be clutter. Scoped to `lib/permissions.ts#
  canViewRequest` (same visibility rule as `GET /api/requests/[id]`), so a plain employee only
  sees their own due items, while CEO/Accounting/Procurement/SUPERADMIN see everything.
  Grouped by due date client-side; color-coded red (past due) / orange (due today) / green
  (upcoming).

---

## Notifications (Discord Webhooks)

Env vars: `DISCORD_WEBHOOK_FACTORY`, `DISCORD_WEBHOOK_MARKETING`, `DISCORD_WEBHOOK_RD`,
`DISCORD_WEBHOOK_STOREINV`, `DISCORD_WEBHOOK_OPF`, `DISCORD_WEBHOOK_RETAIL`,
`DISCORD_WEBHOOK_GA`, `DISCORD_WEBHOOK_OEM`, `DISCORD_WEBHOOK_CEO`, plus an added
`DISCORD_WEBHOOK_DEFAULT` fallback (not in the original spec) for departments without a
dedicated channel — Factory Investment, People & HR & System, Merchandise, and COG have no
listed channel. See `DEPARTMENT_WEBHOOK_ENV` in `lib/constants.ts` and `lib/discord.ts`.

Triggered on: `SUBMITTED`, `PO_UPLOADED`, `BO_APPROVED`, `CEO_APPROVED`, `PAID`, `REJECTED`. A
skip-BO request's `PO_UPLOADED` event also pings the CEO channel directly (BO would normally
act next but is bypassed). `CEO_APPROVED`/`PAID` also ping the CEO channel. A resubmit fires
whichever event matches the stage it lands back on (e.g. resubmitting back to `BO_APPROVED`
fires the `BO_APPROVED` notification), not always `SUBMITTED`.

**Credit-document reminder cron** (`app/api/cron/document-reminder/route.ts`, Vercel Cron on
the 10th and 14th of each month at 9am Bangkok time — `vercel.json`'s `"0 2 10,14 * *"` is
already the UTC-converted schedule, since Vercel Cron runs in UTC and Bangkok is UTC+7)
finds requests whose `expense_type` contains "Credit-รับของก่อนจ่าย", whose `budget_period`
matches the current month, and whose `status` isn't `PAID`/`REJECTED`, then posts one message
per request to that request's department channel naming the requester. **"Also notify the
requester directly" is not a literal per-user Discord DM** — this app has no Discord user-ID
mapping for anyone anywhere, so the requester's name is included in the department-channel
message text instead; there's no infra to actually DM them. Uses `lib/discord.ts`'s exported
`departmentWebhookUrl`/`postToWebhook` helpers (exported for this reason) rather than the
`notify()` function, since the message shape here isn't one of `NotificationEvent`'s cases.
Protected by `CRON_SECRET` (re-added — same env var name as the old, unrelated `/api/cron/
expire` job that was removed with `EXPIRED`), and `/api/cron/*` is exempted from the
middleware's session check (`lib/supabase/middleware.ts`) since Vercel invokes it without a
user session.

---

## File Storage

There is still no real Google Drive API integration in this app (no service account, no
`googleapis` dependency, no credentials in `.env.local`) — building one was out of scope
without provisioned credentials. `/submit`'s Attachments section now has a real OS file
picker/drag-and-drop zone (`app/submit/page.tsx`), but per its own spec falls back to storing
each file as a base64 data URL directly in `files_json` (`FileEntry.url`) when Drive isn't
configured, which is always, in this build. `files_folder_url` (a manually-entered Drive
folder link) is still collected alongside it as before. **Files over 5MB are rejected
client-side** (`MAX_FILE_BYTES` in `app/submit/page.tsx`) since there's no real object storage
backing this — base64 blobs live inline in the `requests.files_json` JSONB column. Each
`FileEntry` also now carries `size` and `doc_type` (one of `DOCUMENT_TYPES` in
`lib/constants.ts`), and required-doc-type checklists are computed by matching `doc_type`
against `EXPENSE_TYPES[].requiredDocs`. If real Drive upload is ever wired up, replace
`fileToEntry()` in `app/submit/page.tsx` with an actual upload call and drop the size cap.

On CEO approval with `ceo_signature_required = true`, the newest `files_json` entry's `name`
gets an `_SIGNED` suffix appended (`app/api/requests/[id]/ceo-approve/route.ts#
markNewestFileSigned`) — this remains metadata-only and unrelated to the base64 fallback
above.

**One exception to the base64-everywhere rule:** PDFs produced by the "Sign this PDF" flow
(`components/shared/PDFSigner.tsx`) upload to a real Supabase Storage bucket
(`signed-documents`) via `POST /api/storage/upload` instead of being inlined as base64 — see
"PDF document signing" above for why this one path uses real Storage while every other
attachment in the app still doesn't.

---

## Tech Stack

- Next.js 14 App Router, TypeScript, Tailwind CSS
- Supabase PostgreSQL (`supabase/migrations/001_initial_schema.sql`) + Supabase Auth
  (Google OAuth, `@mimetta.co` only)
- Vercel hosting, Vercel Cron for the Credit-document reminder (`vercel.json` →
  `/api/cron/document-reminder`, 10th & 14th of each month at 9am Bangkok time — the schedule
  is written in UTC, `"0 2 10,14 * *"`, i.e. 2am UTC = 9am ICT; protect with a `CRON_SECRET`
  env var). The older 48h PO-expiry cron (`/api/cron/expire`) was removed along with the
  `EXPIRED` status (see "Approval Status Flow") — this is an unrelated, newer cron job.
- Discord webhooks for notifications

### Brand

Rebranded to Mimetta's new palette/typeface (was: brown `#9F8361`, cream `#FEFEE9`, border
`#DFD5BC`, dark `#1E1E1E`, Inter). Current palette (`tailwind.config.ts` →
`theme.extend.colors.brand`):

| Token | Hex | Role |
|---|---|---|
| `brand.brown` | `#1F3A2B` forest green | primary actions, active nav, buttons |
| `brand.accent` | `#BD5A2E` burnt terracotta | hover states, badges, highlights |
| `brand.cream` | `#EDE6D8` warm cream | page backgrounds |
| `brand.border` | `#D8CBB0` sandstone beige | borders, cards, dividers |
| `brand.sage` | `#9CAE8C` muted sage | success/approved/positive indicators |
| `brand.dark` | `#1A1A1A` near-black | body text |

### UI Design System (Supabase-dashboard-inspired)

The rebrand above set the color tokens; this pass restyled the actual components to a
Supabase-dashboard aesthetic — white cards with subtle 1px borders (not heavy shadows), tight
consistent spacing, small muted rounded-full status badges (unchanged from the rebrand's
`StatusBadge.tsx`), underline-style tabs, and clean 36px-tall form fields with a soft focus
ring. Reusable primitives live in `app/globals.css` under `@layer components` as `.mm-*`
classes (`mm-card`, `mm-btn-primary`/`mm-btn-secondary`/`mm-btn-danger` + `mm-btn-sm`,
`mm-input`, `mm-table-wrap`/`mm-table`, `mm-tabs`/`mm-tab`/`mm-tab-active`, `mm-page-title`/
`mm-page-subtitle`, `mm-modal-*`) rather than re-deriving the same Tailwind utility string per
component — apply the `.mm-*` class instead of hand-rolling an equivalent one-off when
touching any of these surfaces.

- **Nav** (`components/Nav.tsx`): 48px height, white bg, underline-style active state
  (`border-b-2 border-brand-brown text-brand-brown font-medium` vs. `border-transparent
  text-gray-500` inactive) — not the earlier background-pill style. Sign out is a ghost button.
- **Page layout** (`app/layout.tsx`): `#EDE6D8` page background, `max-w-[1200px]` centered
  content, 24px padding.
- **Buttons**: Primary (`mm-btn-primary`, `#1F3A2B` → `#BD5A2E` on hover), Secondary/Ghost
  (`mm-btn-secondary`), Danger (`mm-btn-danger`, `#FCA5A5` border / `#DC2626` text / `#FEE2E2`
  hover) — all 36px tall by default, `mm-btn-sm` for the 28px inline-table-row variant.
- **Tables**: `mm-table-wrap` + `mm-table` — `#F9F7F4` header row, 11px uppercase muted header
  text, `#F0EAE0` row dividers, `#F9F7F4` row hover, no zebra striping.
- **Tabs**: `mm-tabs`/`mm-tab`/`mm-tab-active` — borderless with a 2px `#1F3A2B` underline on
  the active tab, replacing the earlier filled-pill tab style everywhere it appeared
  (Procurement, BO/CEO Approvals, Accounting).
- **Modals**: `components/shared/RequestDetailModal.tsx`'s shell (the one modal every list page
  shares) now uses `rounded-xl` (12px), an 18px semibold title, and a bordered footer with
  right-aligned actions, matching the redesign spec's Modals section.
- **Filter bar** (`components/FilterBar.tsx`): collapsed behind a "🔽 Filters" toggle by
  default (active-filter count shown on the button, e.g. "Filters (3)"), expanding to a
  bordered card with compact (32px-tall) selects, each with a small grey label *above* it
  rather than inline. A text-only "↺ Clear all" (terracotta `#BD5A2E`) appears only once at
  least one filter is active. Same six filters as before (Month/Status/Category/Expense
  Type/Payment Method/Supplier), each still defaulting to "All".

**Coverage, honestly stated:** the shell/list-page layer (Nav, StatusBadge, FilterBar, the
`RequestDetailModal` header/footer chrome, and every list page's page title/tabs/cards/tables/
buttons — My Requests, Procurement, BO/CEO Approvals, Accounting) is fully converted. The deep
body content of `RequestDetailModal.tsx` (Expense Items table, Payment Details, PO Information,
Attachments, Approval Timeline) and all of `RequestForm.tsx` (the Submit/Edit form itself) were
**not** touched — both are large, already-functioning components where a full pixel-level pass
was out of scope for this batch; they still use the pre-redesign ad hoc Tailwind classes
(functionally identical, just not yet using the `.mm-*` primitives). Apply the same primitives
there in a follow-up pass if/when a full redesign of those two files specifically is requested.

**Token keys were kept as their original brown/cream/border/dark names even though the values
no longer literally match** (`brand.brown` is forest green, not brown) — renaming them would
mean touching every `bg-brand-brown`/`text-brand-brown`/`border-brand-border` usage across the
whole app (dozens of files) for no functional difference, since Tailwind classes only care
about the token's *value*. `accent` and `sage` are new tokens, added because the rebrand needs
colors the old 4-token palette had no equivalent for (a genuine hover-color swap distinct from
the background/border tokens, and a distinct success/positive color).

**Where a real behavioral change was needed, not just a value swap** (since most of the app was
already built entirely on these tokens, so retheming `tailwind.config.ts` alone silently
reskins the vast majority of the UI):
- `components/StatusBadge.tsx` — was generic Tailwind palette classes (`bg-blue-100`, etc.)
  unrelated to the brand tokens; rewritten with the exact per-status hex pairs specified,
  via inline `style` (matching the pattern already used for the CEO-signature banner and
  other exact-hex UI elsewhere in this app) rather than new one-off Tailwind classes.
- Primary buttons: `hover:opacity-90` (dimming) → `hover:bg-brand-accent` (a real color swap
  to terracotta) — 11 occurrences, all the identical `bg-brand-brown ... hover:opacity-90`
  pattern (verified via grep before the sweep), so this was a safe blanket replace.
- `components/Nav.tsx`'s nav-link and sign-out hover states specifically: `hover:bg-brand-cream`
  → `hover:bg-brand-border` — the spec calls for nav hover to use the sandstone/border color,
  distinct from the general "hover:bg-brand-cream" subtle-highlight pattern used elsewhere in
  the app (dropdown items, table rows, etc.), which keeps using cream (now warm cream) via the
  automatic retheme and was deliberately left alone — nothing in the spec asked to change every
  cream hover in the app to the border color, only navigation's.

Font: **DM Sans** (weights 300/400/500/600/700) + Noto Sans Thai fallback, both loaded via
`next/font/google` in `app/layout.tsx` (self-hosted at build time, no runtime Google Fonts
request/FOUC) — kept this existing pattern rather than switching to a manual `<link>`/`@import`
tag, which the spec's literal wording ("Import DM Sans from Google Fonts... update Google
Fonts import link") suggested but would have been a real regression from what was already
there. `--font-inter` (the CSS variable name, referenced in `tailwind.config.ts`'s
`fontFamily.sans`) was renamed to `--font-dm-sans` for clarity, unlike the color token keys
above — there's exactly one call site for this one (`tailwind.config.ts`), so renaming it was
free, unlike the 50+ call sites a color token rename would have touched.

---

## Legacy data migration script

`scripts/migrate-from-sheets.ts` — plain Node script (`npx tsx scripts/migrate-from-sheets.ts`,
or `npm run migrate:sheets`), not part of the Next.js app itself, run manually against the live
database. **Dry-run by default** (reports what it would change, writes nothing); `--apply`
actually writes. Loads `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `.env.local`
itself (a hand-rolled parser, no `dotenv` dependency — Next.js's own env loading doesn't apply
outside the Next.js process).

Two normalization maps, applied to every relevant column:
- `DEPARTMENT_NAME_MAP` / `normalizeDepartment()` → `requests.department`, `roles.dept_scope`
  (comma-separated, normalized per entry then rejoined — `*` passes through untouched),
  `dept_config.dept` (same `*` exception for the fallback row), `categories.department`.
- `CATEGORY_NAME_MAP` / `normalizeCategory()` → `requests.cat_l1`, `requests.items_json[].cat_l1`,
  `roles.cat_l1_scope` (same comma-separated handling).
- Plus the `@coroand.co` → `@mimetta.co` email swap (see "Email Domain Migration" above) across
  `roles.email`, the six `requests` email columns, `dept_config.bo_email`, and
  `audit_log.actor_email`.

Every table is diffed row-by-row (only rows that actually change get written, so re-running is
always a no-op the second time) and the run ends with a report of every department/category
value that matched neither map — worth checking after every run, since an unmatched value is
silently left as-is rather than guessed at.

**⚠️ `DEPARTMENT_NAME_MAP`'s target values, as specified, don't match this app's real
department names — do not run with `--apply` until this is resolved.** A dry run against the
live database (verifying the script itself works, not that its data is safe to write) surfaced
this concretely: `DEPARTMENT_NAME_MAP` maps several old names to suffixed forms like
`"General Administrative (GA)"` / `"Operations/Fulfillment (OPF)"` / `"Factory Investment
(FACINV)"` / `"Store Investment (STOREINV)"` — but the `"(ABBREV)"` suffix is a UI-only display
label (`lib/constants.ts#DEPARTMENT_ABBREV`, appended client-side in dropdowns) that is never
part of the actual stored `department` value (see `lib/constants.ts#DEPARTMENTS` for the real,
unsuffixed canonical list). The live dry run found 60 `categories` rows and 2 `requests` rows
that already correctly hold the plain, unsuffixed form — `--apply` as currently written would
rename them to the suffixed form, which would then silently fail every exact-string-equality
match against `DEPARTMENTS`, `dept_config.dept`, and BO `dept_scope` for those rows (see
"DeptConfig Matching" and "BO Scope Filtering" above) — i.e. it would reintroduce, for four
more departments, the exact class of bug an earlier fix already cleaned up once for
`"Marketing (MKT)"` → `"Marketing"` (see the Category L1/L2 Management bullet under "Settings &
Reference Data" above). The map was kept exactly as specified in the source spec rather than
silently "corrected", since it's not certain which side is wrong (maybe `DEPARTMENTS` itself is
supposed to change) — but it needs a decision before `--apply` is ever used. The live dry run
also found 3 department values and 15 category values matching neither map at all (unmatched,
left as-is); rerun the script to see the current list, since live data continues to change.

---

## Environment Variables

See `.env.local.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose to the client), `NEXT_PUBLIC_SITE_URL`,
the per-department + CEO + default Discord webhook URLs, and `CRON_SECRET` (protects
`/api/cron/document-reminder` — re-added after being removed alongside the old `EXPIRED`-status
cron; same env var name, different job).

---

## Developer Notes

- Surgical edits preferred — minimal changes, never rewrite whole files.
- Thai language strings — preserve exact Thai text, never translate or reword.
- Multi-role users: always check `user.allRoles`, never a single "primary" role
  (`hasRole`/`hasAnyRole`/`rolesOf` in `lib/permissions.ts`).
- DeptConfig score-based matching is computed in the application layer (`lib/permissions.ts`),
  not in SQL — call sites load the full `dept_config` table and match in JS.
- Status transitions and permission checks are centralized in `lib/status.ts` and
  `lib/permissions.ts` — don't duplicate `if (status === ...)` branching ad hoc in routes or
  pages; add a helper there instead.
- Every API route follows the same shape: `requireUser()` → role/scope check (throws
  `ForbiddenError`) → `getRequestOrThrow` → status/transition check (throws `ConflictError`)
  → `updateRequest` → `logAudit` → `notify`. See `lib/request-repo.ts` and
  `lib/api-helpers.ts#handleApiError` for the shared plumbing.
- The submit/edit request form and the read-detail-view-with-optional-inline-edit modal are
  each **one shared component**, not duplicated per page:
  `components/shared/RequestForm.tsx` (used by `/submit` and My Requests' Edit & Resubmit
  modal) and `components/shared/RequestDetailModal.tsx` (used by all five list pages). When
  a field, dropdown, or validation rule needs to change on the submit form, change it once in
  `RequestForm.tsx` — both create and edit mode pick it up automatically. Don't re-introduce a
  second hand-built copy of either.
- "Can this user see this request at all" (as opposed to "can they act on it") is
  `lib/permissions.ts#canViewRequest` — one shared function used by `GET /api/requests/[id]`
  and the homepage's `/api/dashboard/home-stats` and `/api/dashboard/payment-calendar`. Don't
  re-duplicate this role-visibility logic inline in a new route.
