import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";
import {
  canBoActOnRequest,
  canPettyCashActOnRequest,
  hasRole,
  isSuperadmin,
  matchDeptConfig,
  computeCeoSignatureRequired,
  visibleRejectionHistory,
} from "@/lib/permissions";
import {
  isAccountingActionable,
  isBoActionable,
  isCeoActionable,
  isEditRequestPending,
  needsProcurement,
} from "@/lib/status";
import { computeTotals } from "@/lib/totals";
import { getExpenseTypeConfig, PETTY_CASH_LABEL } from "@/lib/constants";
import type { DeptConfigRow, ExpenseRequest, RequestItem } from "@/types/database";

// Postgrest's "column does not exist" code — see the insertPayload/
// UNDEFINED_COLUMN handling in POST below for why this route needs it.
const UNDEFINED_COLUMN = "42703";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") ?? "mine";
    const tab = searchParams.get("tab") ?? "pending";

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("requests")
      .select("*")
      .order("timestamp", { ascending: false });

    if (error) throw error;
    let rows = (data ?? []) as ExpenseRequest[];

    switch (scope) {
      case "mine":
        rows = rows.filter((r) => r.requester_email === user.email);
        break;

      case "procurement": {
        if (!isSuperadmin(user) && !hasRole(user, "PROCUREMENT")) {
          throw new ForbiddenError();
        }
        rows = rows.filter((r) => r.requires_po);
        if (tab === "pending") rows = rows.filter(needsProcurement);
        else if (tab === "uploaded") rows = rows.filter((r) => r.status === "PO_UPLOADED");
        break;
      }

      case "bo": {
        if (!isSuperadmin(user) && !hasRole(user, "BO")) {
          throw new ForbiddenError();
        }
        rows = rows.filter((r) => canBoActOnRequest(user, r));
        if (tab === "pending") rows = rows.filter(isBoActionable);
        else if (tab === "edit-requests") {
          rows = rows.filter((r) => isEditRequestPending(r) && r.status === "BO_APPROVED");
        }
        break;
      }

      // PETTY_CASH_CUSTODIAN's own tab on /bo-approvals — requests where
      // they're the named holder, not a bu/dept/cat_l1 scope match (see
      // canPettyCashActOnRequest).
      case "pettycash": {
        if (!isSuperadmin(user) && !hasRole(user, "PETTY_CASH_CUSTODIAN")) {
          throw new ForbiddenError();
        }
        rows = rows.filter(
          (r) => r.expense_type === PETTY_CASH_LABEL && canPettyCashActOnRequest(user, r),
        );
        if (tab === "pending") rows = rows.filter(isBoActionable);
        break;
      }

      case "ceo": {
        if (!isSuperadmin(user) && !hasRole(user, "CEO")) {
          throw new ForbiddenError();
        }
        if (tab === "pending") rows = rows.filter(isCeoActionable);
        else if (tab === "needs-signature") {
          rows = rows.filter((r) => isCeoActionable(r) && r.ceo_signature_required === true);
        } else if (tab === "edit-requests") {
          rows = rows.filter((r) => isEditRequestPending(r) && r.status === "CEO_APPROVED");
        }
        break;
      }

      case "accounting": {
        if (!isSuperadmin(user) && !hasRole(user, "ACCOUNTING")) {
          throw new ForbiddenError();
        }
        if (tab === "pending") rows = rows.filter(isAccountingActionable);
        else if (tab === "paid") rows = rows.filter((r) => r.status === "PAID");
        else if (tab === "edit-requests") {
          rows = rows.filter((r) => isEditRequestPending(r) && r.status === "PAID");
        }
        break;
      }

      default:
        throw new ForbiddenError(`Unknown scope: ${scope}`);
    }

    rows = rows.map((r) => ({
      ...r,
      rejection_history: visibleRejectionHistory(r.rejection_history, user),
    }));

    return NextResponse.json({ requests: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateRequestBody {
  bu: string;
  expense_type: string;
  urgent_reason?: string;
  department: string;
  budget_period: string;
  product?: string;
  cat_l1?: string;
  cat_l2?: string;
  description?: string;
  items: RequestItem[];
  supplier_name?: string;
  pay_method?: string;
  bank_name?: string;
  card_type?: string;
  account_no?: string;
  pay_ref?: string;
  credit_term_days?: number;
  due_date?: string;
  slip_receiver_email?: string;
  requires_po?: boolean;
  files_folder_url?: string;
  files_json?: { name: string; url: string }[];
  use_for_company?: string;
  petty_cash_holder_email?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as CreateRequestBody;

    if (!body.bu || !body.department || !body.expense_type || !body.budget_period) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
    }
    if (!body.use_for_company) {
      return NextResponse.json({ error: "use_for_company is required" }, { status: 400 });
    }

    const expenseTypeConfig = getExpenseTypeConfig(body.expense_type);
    if (expenseTypeConfig?.isUrgent && !body.urgent_reason) {
      return NextResponse.json(
        { error: "urgent_reason is required for this expense type" },
        { status: 400 },
      );
    }
    if (body.expense_type === PETTY_CASH_LABEL && !body.petty_cash_holder_email) {
      return NextResponse.json(
        { error: "petty_cash_holder_email is required for Petty cash requests" },
        { status: 400 },
      );
    }

    const totals = computeTotals(body.items);
    const requiresPo = body.requires_po ?? expenseTypeConfig?.defaultRequiresPo ?? true;

    const admin = createAdminClient();
    const { data: deptConfigs, error: dcError } = await admin
      .from("dept_config")
      .select("*");
    if (dcError) throw dcError;

    const matched = matchDeptConfig(deptConfigs as DeptConfigRow[], {
      bu: body.bu,
      department: body.department,
      cat_l1: body.cat_l1 ?? null,
    });

    const skipBo = matched?.skip_bo ?? false;
    const skipCeo = matched?.skip_ceo ?? false;
    const ceoSignatureRequired = computeCeoSignatureRequired(matched, totals.total);

    const basePayload = {
      requester_email: user.email,
      requester_name: user.name,
      bu: body.bu,
      expense_type: body.expense_type,
      urgent_reason: body.urgent_reason ?? null,
      department: body.department,
      budget_period: body.budget_period,
      product: body.product ?? null,
      cat_l1: body.cat_l1 ?? null,
      cat_l2: body.cat_l2 ?? null,
      description: body.description ?? null,
      amount_net: totals.amount_net,
      vat_rate: totals.vat_rate,
      vat_amount: totals.vat_amount,
      wht_rate: totals.wht_rate,
      wht_amount: totals.wht_amount,
      total: totals.total,
      supplier_name: expenseTypeConfig?.hidePaymentSection ? null : body.supplier_name ?? null,
      pay_method: expenseTypeConfig?.hidePaymentSection ? null : body.pay_method ?? null,
      bank_name:
        expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
          ? null
          : body.bank_name ?? null,
      card_type:
        expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
          ? null
          : body.card_type ?? null,
      pay_ref:
        expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
          ? null
          : body.pay_ref ?? null,
      account_no:
        expenseTypeConfig?.hidePaymentSection || expenseTypeConfig?.hideBankFields
          ? null
          : body.account_no ?? null,
      credit_term_days: body.credit_term_days ?? null,
      due_date: body.due_date ?? null,
      slip_receiver_email: body.slip_receiver_email ?? user.email,
      status: "SUBMITTED",
      files_folder_url: body.files_folder_url ?? null,
      files_json: body.files_json ?? [],
      requires_po: requiresPo,
      items_json: body.items,
      items_summary: totals.items_summary,
      items_count: totals.items_count,
      skip_bo: skipBo,
      skip_ceo: skipCeo,
      ceo_signature_required: ceoSignatureRequired,
    };

    // supabase/migrations/011_chapter.sql (chapter) and
    // 012_new_features.sql (use_for_company/petty_cash_holder_email/
    // travel_items) may not be applied yet — same silent-retry-without-the-
    // new-columns pattern already used for chapter alone, extended to cover
    // both migrations. Tries: [chapter + 012 fields] -> [chapter only] ->
    // [neither]. This assumes 011 lands before/independently of 012 in the
    // usual case; the reverse ordering (012 applied, 011 not) isn't handled
    // and would fall through to the narrowest tier, same acceptable-edge-
    // case tradeoff already made for PATCH /api/roles/[id]'s 007/011
    // ordering — this is the core Submit flow every user hits constantly,
    // so a loud failure here would be a real regression, not a graceful one.
    const migration012Fields = {
      use_for_company: body.use_for_company ?? null,
      petty_cash_holder_email: body.petty_cash_holder_email ?? null,
      travel_items: body.items
        .filter((i) => i.travel_by)
        .map((i) => ({ travel_by: i.travel_by, distance_km: i.distance_km ?? null })),
    };

    let inserted;
    let insertError;
    ({ data: inserted, error: insertError } = await admin
      .from("requests")
      .insert({ ...basePayload, chapter: user.chapter, ...migration012Fields })
      .select()
      .single());
    if (insertError?.code === UNDEFINED_COLUMN) {
      ({ data: inserted, error: insertError } = await admin
        .from("requests")
        .insert({ ...basePayload, chapter: user.chapter })
        .select()
        .single());
    }
    if (insertError?.code === UNDEFINED_COLUMN) {
      ({ data: inserted, error: insertError } = await admin.from("requests").insert(basePayload).select().single());
    }
    if (insertError) throw insertError;

    const created = inserted as ExpenseRequest;
    await logAudit(user.email, created.request_id, "SUBMITTED", { total: created.total });
    await notify("SUBMITTED", created);

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
