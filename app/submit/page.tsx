"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RequestForm, { type RequestFormInitial, type RequestFormPayload } from "@/components/shared/RequestForm";
import type { DraftRow } from "@/types/database";

// Converts a saved draft's form_data (shaped like RequestFormPayload, from
// buildPayload() inside RequestForm) back into the RequestFormInitial shape
// the form's `initial` prop expects — field names differ (snake_case
// payload vs camelCase initial) but otherwise it's a 1:1 mapping.
// requesterName/chapter are deliberately omitted: RequestForm already falls
// back to the signed-in user's own name/chapter when `initial` doesn't
// supply them, which is exactly what a re-opened draft should show anyway.
function draftToFormInitial(formData: Record<string, unknown>): Partial<RequestFormInitial> {
  const p = formData as Partial<RequestFormPayload>;
  return {
    bu: p.bu,
    department: p.department,
    expenseType: p.expense_type,
    urgentReason: p.urgent_reason ?? "",
    budgetPeriod: p.budget_period,
    product: p.product ?? "",
    requiresPo: p.requires_po,
    items: p.items,
    supplierName: p.supplier_name ?? "",
    payMethod: p.pay_method ?? "",
    bankName: p.bank_name ?? "",
    cardType: p.card_type ?? "",
    accountNo: p.account_no ?? "",
    creditTermDays: p.credit_term_days ?? "",
    dueDate: p.due_date ?? "",
    slipReceiverEmail: p.slip_receiver_email ?? "",
    filesFolderUrl: p.files_folder_url ?? "",
    files: p.files_json ?? [],
    useForCompany: p.use_for_company ?? "",
    pettyCashHolderEmail: p.petty_cash_holder_email ?? "",
  };
}

// useSearchParams() requires a Suspense boundary in the App Router — same
// pattern as SettingsClient (see app/settings/settingsClient.tsx).
export default function SubmitPage() {
  return (
    <Suspense fallback={<p className="text-sm text-brand-muted">Loading...</p>}>
      <SubmitPageInner />
    </Suspense>
  );
}

function SubmitPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");

  const [draftInitial, setDraftInitial] = useState<Partial<RequestFormInitial> | undefined>(undefined);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(!!draftIdParam);

  useEffect(() => {
    if (!draftIdParam) {
      setLoadingDraft(false);
      return;
    }
    fetch("/api/drafts")
      .then((res) => res.json())
      .then((data) => {
        const draft = (data.drafts ?? []).find((d: DraftRow) => String(d.id) === draftIdParam);
        if (draft) {
          setDraftInitial(draftToFormInitial(draft.form_data));
          setDraftId(draft.id);
        }
      })
      .finally(() => setLoadingDraft(false));
  }, [draftIdParam]);

  const handleSubmit = async (payload: RequestFormPayload) => {
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to submit request");
    }

    router.push("/my");
  };

  if (loadingDraft) {
    return <p className="text-sm text-brand-muted">Loading draft...</p>;
  }

  return (
    <RequestForm
      key={draftId ?? "new"}
      initial={draftInitial}
      onSubmit={handleSubmit}
      submitLabel="Submit Request"
      submittingLabel="Submitting..."
      enableDrafts
      draftId={draftId}
    />
  );
}
