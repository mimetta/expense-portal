"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import RequiredMark from "@/components/shared/RequiredMark";
import PDFSigner from "@/components/shared/PDFSigner";
import RequestForm, { requestToFormInitial, openStoredFile, type RequestFormPayload } from "@/components/shared/RequestForm";
import { formatCurrency, formatDate } from "@/lib/format";
import { computeTotals } from "@/lib/totals";
import {
  BANK_OPTIONS,
  CARD_TYPES,
  DOCUMENT_TYPES,
  PAYMENT_METHODS,
  PETTY_CASH_LABEL,
  PRINTABLE_EXPENSE_TYPES,
  getExpenseTypeConfig,
} from "@/lib/constants";
import { isBoActionable, isCeoActionable, isAccountingActionable, isOwnerEditable, needsProcurement } from "@/lib/status";
import { canPettyCashActOnRequest } from "@/lib/permissions";
import type { CompanyRow, ExpenseRequest, FileEntry, RequestItem, RoleRow, SupplierRow } from "@/types/database";

const inputClass =
  "w-full rounded-md border border-brand-border bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-brown";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fileToEntry(file: File): Promise<FileEntry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, url: reader.result as string, size: file.size, doc_type: "" });
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export interface ProcurementSavePatch {
  items_json: RequestItem[];
  supplier_name: string;
  pay_method: string;
  bank_name: string;
  card_type: string;
  account_no: string;
  due_date: string;
  credit_term_days: number | undefined;
  slip_receiver_email: string;
  po_number: string;
  po_date: string;
  po_vendor: string;
  po_delivery_date: string;
  po_notes: string;
  files_json: FileEntry[];
}

interface RequestDetailModalProps {
  request: ExpenseRequest;
  onClose: () => void;
  // Turns Net/VAT/WHT per item, payment fields, slip receiver, and PO
  // details into inputs. Everything else in the modal stays read-only
  // regardless.
  editable?: boolean;
  onSaveChanges?: (patch: ProcurementSavePatch) => Promise<void>;
  // Page-specific buttons (Approve/Reject/Upload PO/Mark Paid/...), rendered
  // in the footer alongside Save Changes (if onSaveChanges is provided).
  actions?: React.ReactNode;
  // Extra footer content on the opposite side from actions — e.g. My
  // Requests' Edit & Resubmit button + countdown.
  footerExtra?: React.ReactNode;
  // Called after a successful in-place owner edit (see fullEditMode below)
  // so the page that opened this modal can refresh its list. Optional —
  // pages that never show a SUBMITTED+owner-editable request in practice
  // (Procurement/BO/CEO/Accounting) can simply omit it.
  onOwnerSaved?: () => void;
  // Whether the "BO: {name}" badge shows in the header — on by default
  // since this modal is the one shared "request preview" surface every
  // page has (My Requests, Procurement, CEO Approvals, Accounting all
  // want it), but BO Approvals passes false: a BO looking at their own
  // approvals queue doesn't need to be told who the BO approver is/would
  // be. The Due Date line next to it is unaffected by this prop.
  showBoApprover?: boolean;
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-brand-muted">{label}</div>
      <div className="text-sm text-brand-dark">{children}</div>
    </div>
  );
}

type StepState = "done" | "current" | "pending" | "skipped";

interface TimelineStep {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

function buildTimeline(r: ExpenseRequest): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "SUBMITTED", label: "Submitted", state: "done", detail: `${r.requester_name} — ${formatDate(r.timestamp)}` },
  ];

  if (!r.requires_po) {
    steps.push({ key: "PO_UPLOADED", label: "PO Uploaded", state: "skipped", detail: "Not required" });
  } else if (r.po_uploaded_at) {
    steps.push({
      key: "PO_UPLOADED",
      label: "PO Uploaded",
      state: "done",
      detail: `${r.po_uploaded_by ?? "-"} — ${formatDate(r.po_uploaded_at)}`,
    });
  } else if (needsProcurement(r)) {
    steps.push({ key: "PO_UPLOADED", label: "PO Uploaded", state: "current", detail: "Awaiting PO upload" });
  } else {
    steps.push({ key: "PO_UPLOADED", label: "PO Uploaded", state: "pending" });
  }

  if (r.skip_bo) {
    steps.push({ key: "BO_APPROVED", label: "BO Approved", state: "skipped", detail: "Skipped (bypassed)" });
  } else if (r.bo_approved_at) {
    steps.push({
      key: "BO_APPROVED",
      label: "BO Approved",
      state: "done",
      detail: `${r.bo_approver ?? "-"} — ${formatDate(r.bo_approved_at)}`,
    });
  } else if (isBoActionable(r)) {
    steps.push({ key: "BO_APPROVED", label: "BO Approved", state: "current", detail: "Awaiting BO approval" });
  } else {
    steps.push({ key: "BO_APPROVED", label: "BO Approved", state: "pending" });
  }

  if (r.ceo_approved_at) {
    steps.push({
      key: "CEO_APPROVED",
      label: "CEO Approved",
      state: "done",
      detail: `${r.ceo_approver ?? "-"} — ${formatDate(r.ceo_approved_at)}${r.ceo_signature_required ? " (signature required)" : ""}`,
    });
  } else if (isCeoActionable(r)) {
    steps.push({ key: "CEO_APPROVED", label: "CEO Approved", state: "current", detail: "Awaiting CEO approval" });
  } else {
    steps.push({ key: "CEO_APPROVED", label: "CEO Approved", state: "pending" });
  }

  if (r.paid_at) {
    steps.push({
      key: "PAID",
      label: "Paid",
      state: "done",
      detail: `${r.accounting_user ?? "-"} — ${formatDate(r.paid_at)}`,
    });
  } else if (isAccountingActionable(r)) {
    steps.push({ key: "PAID", label: "Paid", state: "current", detail: "Awaiting payment" });
  } else {
    steps.push({ key: "PAID", label: "Paid", state: "pending" });
  }

  return steps;
}

const STEP_CIRCLE_CLASS: Record<StepState, string> = {
  done: "bg-green-600 text-white",
  current: "bg-brand-brown text-white",
  skipped: "bg-gray-200 text-gray-500",
  pending: "bg-gray-100 text-gray-400",
};

export default function RequestDetailModal({
  request,
  onClose,
  editable = false,
  onSaveChanges,
  actions,
  footerExtra,
  onOwnerSaved,
  showBoApprover = true,
}: RequestDetailModalProps) {
  const [items, setItems] = useState<RequestItem[]>(request.items_json);
  const [payment, setPayment] = useState({
    supplier_name: request.supplier_name ?? "",
    pay_method: request.pay_method ?? "",
    bank_name: request.bank_name ?? "",
    card_type: request.card_type ?? "",
    account_no: request.account_no ?? "",
    due_date: request.due_date ?? "",
    credit_term_days: (request.credit_term_days ?? "") as number | "",
    slip_receiver_email: request.slip_receiver_email ?? "",
  });
  const [poDetails, setPoDetails] = useState({
    po_number: request.po_number ?? "",
    po_date: request.po_date ?? "",
    po_vendor: request.po_vendor ?? "",
    po_delivery_date: request.po_delivery_date ?? "",
    po_notes: request.po_notes ?? "",
  });
  const [files, setFiles] = useState<FileEntry[]>(request.files_json);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);

  const [currentUser, setCurrentUser] = useState<{ email: string; allRoles: RoleRow[] } | null>(null);
  // Which file in `files` (by index) currently has its PDFSigner panel open
  // — at most one at a time, shown inline below that file's row.
  const [signingFileIndex, setSigningFileIndex] = useState<number | null>(null);
  const [signSuccess, setSignSuccess] = useState(false);
  // In-place full-form edit (Basic Info/PO Required/Items/Payment/
  // Attachments), toggled from the "✏️ Edit" button in the header — see
  // canOwnerEditNow below. Separate from `editable` (that's Procurement's
  // narrower inline-edit mode for a different set of fields/roles).
  const [fullEditMode, setFullEditMode] = useState(false);

  useEffect(() => {
    if (!editable) return;
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((d) => setSuppliers(d.suppliers ?? []))
      .catch((err) => console.error("[suppliers] failed to load:", err));
    fetch("/api/roles").then((r) => r.json()).then((d) => setRoles(d.roles ?? []));
  }, [editable]);

  useEffect(() => {
    if (!request.use_for_company) return;
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(d.companies ?? []));
  }, [request.use_for_company]);

  // Needed to know whether the viewer is BO/CEO for the "Sign this PDF"
  // button — unrelated to `editable` (that flag is Procurement-specific),
  // so this fetches regardless of it.
  useEffect(() => {
    fetch("/api/roles/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setCurrentUser({ email: d.user.email, allRoles: d.user.allRoles ?? [] });
      });
  }, []);

  const isSuperadminUser = currentUser?.allRoles.some((r) => r.role === "SUPERADMIN") ?? false;
  const canSignAsBo =
    (isSuperadminUser || currentUser?.allRoles.some((r) => r.role === "BO")) && isBoActionable(request);
  const canSignAsCeo =
    (isSuperadminUser || currentUser?.allRoles.some((r) => r.role === "CEO")) &&
    request.ceo_signature_required &&
    isCeoActionable(request);
  const signableAs: "BO" | "CEO" | null = canSignAsBo ? "BO" : canSignAsCeo ? "CEO" : null;

  const isOwnerOfRequest = currentUser?.email === request.requester_email;
  const canOwnerEditNow = (isOwnerOfRequest || isSuperadminUser) && isOwnerEditable(request);

  // Print view — Accounting stage and above (CEO_APPROVED/PAID), any time
  // for SUPERADMIN/ACCOUNTING, or the request's own owner/petty cash
  // holder at any status (previously the owner had no way to print their
  // own request until it reached CEO_APPROVED, even though it's theirs).
  // canPettyCashActOnRequest expects a full CurrentUser (email/name/
  // allRoles/chapter) and doesn't null-guard internally — this component's
  // local `currentUser` state only carries email/allRoles (see GET
  // /api/roles/me's field whitelist), so it's null-checked here first and
  // padded with placeholder name/chapter values the function never reads.
  const hasAccountingRole = currentUser?.allRoles.some((r) => r.role === "ACCOUNTING") ?? false;
  const isPettyCashHolderForRequest =
    !!currentUser && canPettyCashActOnRequest({ ...currentUser, name: "", chapter: null }, request);
  const canPrint =
    PRINTABLE_EXPENSE_TYPES.includes(request.expense_type) &&
    (isSuperadminUser ||
      hasAccountingRole ||
      isOwnerOfRequest ||
      isPettyCashHolderForRequest ||
      request.status === "CEO_APPROVED" ||
      request.status === "PAID");

  const filteredSuppliers = useMemo(() => {
    const q = payment.supplier_name.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, payment.supplier_name]);

  const distinctReceiverEmails = useMemo(
    () => Array.from(new Set(roles.map((r) => r.email))).sort(),
    [roles],
  );

  const handleSupplierChange = (name: string) => {
    const match = suppliers.find((s) => s.name === name);
    setPayment((p) => ({
      ...p,
      supplier_name: name,
      pay_method: match?.payment_method || p.pay_method,
      bank_name: match?.bank_name || p.bank_name,
      account_no: match?.account_no || p.account_no,
      slip_receiver_email: match?.email || p.slip_receiver_email,
    }));
  };

  const expenseConfig = getExpenseTypeConfig(request.expense_type);
  const totals = computeTotals(items.length > 0 ? items : request.items_json);
  const timeline = buildTimeline(request);
  // Retail/R&D + Petty cash requests carry a per-item branch/product instead
  // of the top-level `product` field (see RequestForm.tsx#perItemFieldMode)
  // — only show the column when at least one item actually has one, so
  // every other request's table is unchanged. Reuses branchLabel below for
  // the column header too, since the department->label mapping is the same.
  const hasItemProductColumn = items.some((it) => it.product);
  const branchLabel =
    request.department === "R&D" ? "Product" : request.department === "Retail" ? "Branch" : "Product/Branch";
  // Segment lives per item now (see CLAUDE.md "Multi-Item Requests" /
  // RequestForm.tsx) — always shown as its own column. Travel by/Distance
  // only show when at least one item actually has a travel_by (i.e. this
  // is a เบิกค่าเดินทาง request).
  const hasItemTravelColumns = items.some((it) => it.travel_by);
  // Signed files (whether a re-uploaded PO/Invoice or a PDFSigner-produced
  // *_SIGNED.pdf — see components/shared/PDFSigner.tsx — use unrelated
  // naming) can't be reliably matched back to one specific original
  // document, so "is this signed" is treated as one yes/no for the whole
  // request: if any attached file is signed, none of the PO/Invoice files
  // show "Needs Signature" anymore.
  const hasSignedFile = files.some((f) => f.name.includes("SIGNED"));
  const isPdfFile = (f: FileEntry) => f.name.toLowerCase().endsWith(".pdf");

  const updateItem = (idx: number, patch: Partial<RequestItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const handleFiles = async (fileList: FileList) => {
    const entries: FileEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        alert(`${file.name} is larger than 5MB and can't be attached.`);
        continue;
      }
      try {
        entries.push(await fileToEntry(file));
      } catch {
        alert(`Failed to read ${file.name}`);
      }
    }
    setFiles((prev) => [...prev, ...entries]);
  };
  const updateFile = (idx: number, patch: Partial<FileEntry>) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  // Called by PDFSigner after it has already rendered, stamped, and
  // uploaded the signed PDF to Supabase Storage — this only attaches the
  // resulting entry to the request's files_json. Throws on failure so
  // PDFSigner's own try/catch can surface the error inline in its panel
  // rather than losing it after the panel has already "succeeded".
  const handleSignatureSaved = async (entry: FileEntry) => {
    const nextFiles = [...files, entry];
    const res = await fetch(`/api/requests/${request.request_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attach_signature: true, files_json: nextFiles }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error([body.error, body.hint].filter(Boolean).join(" — ") || "Failed to attach signed PDF");
    }
    setFiles(nextFiles);
    setSigningFileIndex(null);
    setSignSuccess(true);
    setTimeout(() => setSignSuccess(false), 4000);
  };

  // RequestForm's onSubmit contract: throw on failure (it displays the
  // message itself), resolve on success. See PATCH /api/requests/[id]'s doc
  // comment for why owner_edit is an explicit flag.
  const handleOwnerEditSubmit = async (payload: RequestFormPayload) => {
    const res = await fetch(`/api/requests/${request.request_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, owner_edit: true }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error([body.error, body.hint].filter(Boolean).join(" — ") || "Failed to save changes");
    }
    onOwnerSaved?.();
    onClose();
  };

  const handleSave = async () => {
    if (!onSaveChanges) return;
    // PO Number is marked required (see its label) only in the sense that
    // it's needed to actually record a PO — other PO detail fields without
    // a number don't mean anything on their own.
    const enteringPoDetails = poDetails.po_date || poDetails.po_vendor || poDetails.po_delivery_date || poDetails.po_notes;
    if (enteringPoDetails && !poDetails.po_number.trim()) {
      setSaveError("PO Number is required to save PO details");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveChanges({
        items_json: items,
        ...payment,
        credit_term_days: payment.credit_term_days === "" ? undefined : payment.credit_term_days,
        ...poDetails,
        files_json: files,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-brand-border bg-white shadow-lg"
        style={{ maxWidth: 780 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#F0EAE0] px-6 pb-4 pt-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-brand-dark">{request.request_id}</span>
              <StatusBadge status={request.status} />
              <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs text-brand-dark">
                {request.use_for_company || request.bu}
              </span>
            </div>
            <p className="mt-1 text-xs text-brand-subtle">Submitted {formatDate(request.timestamp)}</p>
            {(request.due_date || showBoApprover) && (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-brand-muted">
                <span>{request.due_date ? `Due ${formatDate(request.due_date)}` : ""}</span>
                {showBoApprover && (
                  <span className="inline-flex items-center rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-[11px] font-medium text-[#374151]">
                    BO: {request.bo_approver ?? "—"}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {canPrint && (
              <button
                type="button"
                onClick={() => window.open(`/print/${request.request_id}`, "_blank")}
                className="mm-btn-secondary mm-btn-sm"
              >
                🖨️ Print
              </button>
            )}
            {canOwnerEditNow && !fullEditMode && (
              <button onClick={() => setFullEditMode(true)} className="mm-btn-secondary mm-btn-sm">
                ✏️ Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-xl leading-none text-brand-muted transition-colors hover:bg-[#F5F0E8] hover:text-brand-dark"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          {fullEditMode ? (
            <RequestForm
              initial={requestToFormInitial(request)}
              uploadContext={{ requestId: request.request_id }}
              title="Edit Request"
              banner={
                <div className="flex items-center justify-between gap-3 rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm text-brand-dark">
                  <span>You can edit this request freely until Procurement takes action on it.</span>
                  <button
                    type="button"
                    onClick={() => setFullEditMode(false)}
                    className="whitespace-nowrap font-medium text-brand-brown hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              }
              submitLabel="Save Changes"
              submittingLabel="Saving..."
              onSubmit={handleOwnerEditSubmit}
            />
          ) : (
            <>
          {request.ceo_signature_required && (request.status === "BO_APPROVED" || request.status === "PO_UPLOADED") && (
            <div
              className="text-sm font-bold"
              style={{
                background: "#DBEAFE",
                borderLeft: "4px solid #3B82F6",
                padding: "12px 16px",
                marginBottom: 16,
              }}
            >
              ✍️ ต้องการลายเซ็น CEO — กรุณาดาวน์โหลด เซ็น และอัปโหลดไฟล์กลับพร้อมชื่อไฟล์ที่มี
              _SIGNED
            </div>
          )}

          {/* Purely informational — lets the requester know up front (from
              the moment of submission) that a CEO signature will eventually
              be required, without implying it's actionable yet. Deliberately
              excludes BO_APPROVED/PO_UPLOADED, where the actionable blue
              banner above already covers this — the two never show together. */}
          {request.ceo_signature_required &&
            request.status !== "BO_APPROVED" &&
            request.status !== "PO_UPLOADED" && (
              <div
                className="text-xs text-brand-muted"
                style={{
                  background: "#F9F8F6",
                  borderLeft: "3px solid #93C5FD",
                  padding: "8px 12px",
                  marginBottom: 16,
                }}
              >
                ℹ️ คำขอนี้ต้องมีลายเซ็น CEO ก่อนการจ่ายเงิน (This request will require a CEO
                signature before payment)
              </div>
            )}

          {/* Request Info */}
          <section>
            <h3 className="mm-section-label">Request Info</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Requester">{request.requester_name} ({request.requester_email})</Field>
              <Field label="Expense Type">{request.expense_type}</Field>
              <Field label="Segment">{request.department}</Field>
              <Field label="Budget Period">{request.budget_period}</Field>
              {request.use_for_company && (
                <Field label="Use for company">
                  {(() => {
                    const c = companies.find((c) => c.bu === request.use_for_company);
                    return c ? `${c.bu} — ${c.name_en}` : request.use_for_company;
                  })()}
                </Field>
              )}
              {request.expense_type === PETTY_CASH_LABEL && request.petty_cash_holder_email && (
                <Field label="Petty cash holder">{request.petty_cash_holder_email}</Field>
              )}
              {expenseConfig?.isUrgent && request.urgent_reason && (
                <div className="col-span-2">
                  <Field label="Urgent Reason">{request.urgent_reason}</Field>
                </div>
              )}
            </div>
          </section>

          {/* Expense Items */}
          <section>
            <h3 className="mm-section-label">Expense Items</h3>
            {/* Top-level Product/Branch (non-Petty-Cash Retail/R&D requests
                only — matches RequestForm.tsx's relocation of the same
                field into this box). request.product is only ever set for
                this single-value case; Petty Cash's per-item equivalent
                lives in the table below instead (hasItemProductColumn). */}
            {request.product && (
              <p className="mb-2 text-xs text-brand-dark">
                <span className="text-brand-subtle">{branchLabel}: </span>
                {request.product}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border border-brand-border">
              <table className="w-full text-xs">
                <thead className="bg-[#F9F8F6] text-left text-brand-dark">
                  <tr>
                    <th className="px-2 py-1.5">Segment</th>
                    {hasItemTravelColumns && <th className="px-2 py-1.5">Travel by</th>}
                    {hasItemTravelColumns && <th className="px-2 py-1.5">Distance (km)</th>}
                    <th className="px-2 py-1.5">Cat L1</th>
                    <th className="px-2 py-1.5">Cat L2</th>
                    {hasItemProductColumn && <th className="px-2 py-1.5">{branchLabel}</th>}
                    <th className="px-2 py-1.5">Product Code</th>
                    <th className="px-2 py-1.5">Description</th>
                    <th className="px-2 py-1.5">Net Amount</th>
                    <th className="px-2 py-1.5">VAT%</th>
                    <th className="px-2 py-1.5">WHT%</th>
                    <th className="px-2 py-1.5">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal =
                      item.amount_net + (item.amount_net * item.vat_rate) / 100 - (item.amount_net * item.wht_rate) / 100;
                    return (
                      <tr key={idx} className="border-t border-brand-border">
                        <td className="px-2 py-1.5">{item.segment || "-"}</td>
                        {hasItemTravelColumns && <td className="px-2 py-1.5">{item.travel_by || "—"}</td>}
                        {hasItemTravelColumns && (
                          <td className="px-2 py-1.5">{item.distance_km ?? "—"}</td>
                        )}
                        <td className="px-2 py-1.5">{item.cat_l1 || "-"}</td>
                        <td className="px-2 py-1.5">{item.cat_l2 || "-"}</td>
                        {hasItemProductColumn && <td className="px-2 py-1.5">{item.product || "—"}</td>}
                        <td className="px-2 py-1.5">{item.product_code || "-"}</td>
                        <td className="px-2 py-1.5">{item.description}</td>
                        <td className="px-2 py-1.5">
                          {editable ? (
                            <input
                              type="number"
                              className={inputClass}
                              value={item.amount_net || ""}
                              onChange={(e) => updateItem(idx, { amount_net: Number(e.target.value) })}
                            />
                          ) : (
                            formatCurrency(item.amount_net)
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editable ? (
                            <input
                              type="number"
                              className={inputClass}
                              value={item.vat_rate}
                              onChange={(e) => updateItem(idx, { vat_rate: Number(e.target.value) })}
                            />
                          ) : (
                            `${item.vat_rate}%`
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editable ? (
                            <input
                              type="number"
                              className={inputClass}
                              value={item.wht_rate}
                              onChange={(e) => updateItem(idx, { wht_rate: Number(e.target.value) })}
                            />
                          ) : (
                            `${item.wht_rate}%`
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-medium">{formatCurrency(lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-brand-border bg-[#F9F8F6] font-semibold">
                  <tr>
                    <td
                      colSpan={
                        1 +
                        (hasItemTravelColumns ? 2 : 0) +
                        2 +
                        (hasItemProductColumn ? 1 : 0) +
                        2
                      }
                      className="px-2 py-1.5 text-right"
                    >
                      Totals
                    </td>
                    <td className="px-2 py-1.5">{formatCurrency(totals.amount_net)}</td>
                    <td className="px-2 py-1.5" colSpan={2}>
                      VAT {formatCurrency(totals.vat_amount)} · WHT {formatCurrency(totals.wht_amount)}
                    </td>
                    <td className="px-2 py-1.5">{formatCurrency(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Payment Details */}
          {!expenseConfig?.hidePaymentSection && (
            <section>
              <h3 className="mm-section-label flex items-center gap-2">
                <span>{editable ? "📋 Procurement Details" : "Payment Details"}</span>
                {editable && request.procurement_fills_payment && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal"
                    style={{ background: "#FEF3C7", color: "#92400E" }}
                  >
                    Needs your input
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field label="Supplier">
                  {editable ? (
                    <div className="relative">
                      <input
                        className={inputClass}
                        autoComplete="off"
                        placeholder="Type to search or enter a new supplier"
                        value={payment.supplier_name}
                        onChange={(e) => {
                          setPayment({ ...payment, supplier_name: e.target.value });
                          setSupplierOpen(true);
                        }}
                        onFocus={() => setSupplierOpen(true)}
                        onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
                      />
                      {supplierOpen && filteredSuppliers.length > 0 && (
                        <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-brand-border bg-white text-xs shadow-lg">
                          {filteredSuppliers.map((s) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  handleSupplierChange(s.name);
                                  setSupplierOpen(false);
                                }}
                                className="block w-full px-2 py-1.5 text-left hover:bg-[#F9F8F6]"
                              >
                                {s.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    request.supplier_name || "-"
                  )}
                </Field>
                <Field label="Payment Method">
                  {editable ? (
                    <select
                      className={inputClass}
                      value={payment.pay_method}
                      onChange={(e) => setPayment({ ...payment, pay_method: e.target.value })}
                    >
                      <option value="">-</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    request.pay_method || "-"
                  )}
                </Field>
                {!expenseConfig?.hideBankFields && (
                  <>
                    <Field label="Bank Name">
                      {editable ? (
                        <select
                          className={inputClass}
                          value={payment.bank_name}
                          onChange={(e) => setPayment({ ...payment, bank_name: e.target.value })}
                        >
                          <option value="">-</option>
                          {BANK_OPTIONS.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      ) : (
                        request.bank_name || "-"
                      )}
                    </Field>
                    <Field label="Card Type">
                      {editable ? (
                        <select
                          className={inputClass}
                          value={payment.card_type}
                          onChange={(e) => setPayment({ ...payment, card_type: e.target.value })}
                        >
                          <option value="">-</option>
                          {CARD_TYPES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        request.card_type || "-"
                      )}
                    </Field>
                    <Field label="Account No">
                      {editable ? (
                        <input
                          className={inputClass}
                          value={payment.account_no}
                          onChange={(e) => setPayment({ ...payment, account_no: e.target.value })}
                        />
                      ) : (
                        request.account_no || "-"
                      )}
                    </Field>
                  </>
                )}
                <Field label="Due Date">
                  {editable ? (
                    <input
                      type="date"
                      className={inputClass}
                      value={payment.due_date}
                      onChange={(e) => setPayment({ ...payment, due_date: e.target.value })}
                    />
                  ) : (
                    request.due_date || "-"
                  )}
                </Field>
                <Field label="Credit Term (days)">
                  {editable ? (
                    <input
                      type="number"
                      className={inputClass}
                      value={payment.credit_term_days}
                      onChange={(e) =>
                        setPayment({ ...payment, credit_term_days: e.target.value === "" ? "" : Number(e.target.value) })
                      }
                    />
                  ) : (
                    request.credit_term_days ?? "-"
                  )}
                </Field>
                <Field label="Slip Receiver">
                  {editable ? (
                    <select
                      className={inputClass}
                      value={payment.slip_receiver_email}
                      onChange={(e) => setPayment({ ...payment, slip_receiver_email: e.target.value })}
                    >
                      <option value="">-</option>
                      {payment.slip_receiver_email && !distinctReceiverEmails.includes(payment.slip_receiver_email) && (
                        <option value={payment.slip_receiver_email}>{payment.slip_receiver_email}</option>
                      )}
                      {distinctReceiverEmails.map((email) => (
                        <option key={email} value={email}>{email}</option>
                      ))}
                    </select>
                  ) : (
                    request.slip_receiver_email || "-"
                  )}
                </Field>
              </div>
            </section>
          )}

          {/* PO Information */}
          {request.requires_po && (
            <section>
              <h3 className="mm-section-label">PO Information</h3>
              {editable ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <Field label={<>PO Number<RequiredMark /></>}>
                    <input
                      className={inputClass}
                      value={poDetails.po_number}
                      onChange={(e) => setPoDetails({ ...poDetails, po_number: e.target.value })}
                    />
                  </Field>
                  <Field label="PO Date">
                    <input
                      type="date"
                      className={inputClass}
                      value={poDetails.po_date}
                      onChange={(e) => setPoDetails({ ...poDetails, po_date: e.target.value })}
                    />
                  </Field>
                  <Field label="Vendor">
                    <input
                      className={inputClass}
                      value={poDetails.po_vendor}
                      onChange={(e) => setPoDetails({ ...poDetails, po_vendor: e.target.value })}
                    />
                  </Field>
                  <Field label="Delivery Date">
                    <input
                      type="date"
                      className={inputClass}
                      value={poDetails.po_delivery_date}
                      onChange={(e) => setPoDetails({ ...poDetails, po_delivery_date: e.target.value })}
                    />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Notes">
                      <input
                        className={inputClass}
                        value={poDetails.po_notes}
                        onChange={(e) => setPoDetails({ ...poDetails, po_notes: e.target.value })}
                      />
                    </Field>
                  </div>
                  {request.po_uploaded_by && (
                    <div className="col-span-2">
                      <Field label="Uploaded by">
                        {request.po_uploaded_by} — {formatDate(request.po_uploaded_at)}
                      </Field>
                    </div>
                  )}
                </div>
              ) : request.po_uploaded_at ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <Field label="PO Number">{request.po_number || "-"}</Field>
                  <Field label="PO Date">{request.po_date || "-"}</Field>
                  <Field label="Vendor">{request.po_vendor || "-"}</Field>
                  <Field label="Delivery Date">{request.po_delivery_date || "-"}</Field>
                  <div className="col-span-2">
                    <Field label="Notes">{request.po_notes || "-"}</Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Uploaded by">
                      {request.po_uploaded_by ?? "-"} — {formatDate(request.po_uploaded_at)}
                    </Field>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-brand-muted">Awaiting PO upload</p>
              )}
            </section>
          )}

          {/* Attachments */}
          <section>
            <h3 className="mm-section-label">Attachments</h3>
            {expenseConfig?.requiredDocs && (
              <div className="mb-3 rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm">
                <p className="mb-1 font-medium text-brand-dark">
                  Required documents{expenseConfig.requiredDocs.mode === "any" ? " (at least one)" : ""}
                </p>
                <ul className="space-y-0.5">
                  {expenseConfig.requiredDocs.docs.map((docLabel) => {
                    const satisfied = files.some((f) => f.doc_type === docLabel);
                    return (
                      <li key={docLabel} className={satisfied ? "text-green-700" : "text-brand-muted"}>
                        {satisfied ? "✓" : "○"} {docLabel}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {request.files_folder_url && (
              <a
                href={request.files_folder_url}
                target="_blank"
                rel="noreferrer"
                className="mb-2 block text-sm text-brand-brown hover:underline"
              >
                📁 Open Drive Folder
              </a>
            )}
            {files.length === 0 ? (
              <p className="mb-2 text-sm text-brand-muted">No files attached.</p>
            ) : (
              <ul className="mb-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      {editable ? (
                        <select
                          // Deliberately not `${inputClass} w-48` — inputClass already
                          // bakes in w-full, and Tailwind's generated w-full/w-48 rules
                          // share specificity, so which one visually wins depends on
                          // generation order in the compiled stylesheet, not on className
                          // string order. That let w-full silently win here, leaving this
                          // select ~620px wide in a 730px row and squeezing the filename
                          // link next to it down to 0px width. Spelled out explicitly
                          // (everything inputClass has, minus w-full) instead, plus
                          // shrink-0 so it can't be squeezed back down by its flex-1
                          // sibling once that sibling's own min-w-0 fix (see git history)
                          // actually has room to use.
                          className="w-48 shrink-0 rounded-md border border-brand-border bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-brown"
                          value={f.doc_type ?? ""}
                          onChange={(e) => updateFile(i, { doc_type: e.target.value })}
                        >
                          <option value="">Document type...</option>
                          {DOCUMENT_TYPES.map((dt) => (
                            <option key={dt} value={dt}>{dt}</option>
                          ))}
                        </select>
                      ) : (
                        f.doc_type && (
                          <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs text-brand-dark">
                            {f.doc_type}
                          </span>
                        )
                      )}
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          if (f.path) {
                            e.preventDefault();
                            openStoredFile(f);
                          }
                        }}
                        className="min-w-0 flex-1 truncate text-brand-brown hover:underline"
                      >
                        {f.name}
                      </a>
                      {f.name.includes("SIGNED") && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: "#D1FAE5", color: "#065F46" }}
                        >
                          ✓ Signed
                        </span>
                      )}
                      {!f.name.includes("SIGNED") &&
                        request.ceo_signature_required &&
                        !hasSignedFile &&
                        (f.doc_type === "PO" || f.doc_type === "Invoice") && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ background: "#FEF3C7", color: "#92400E" }}
                          >
                            ✍️ Needs Signature
                          </span>
                        )}
                      {f.size !== undefined && <span className="text-xs text-brand-muted">{formatBytes(f.size)}</span>}
                      {signableAs && isPdfFile(f) && signingFileIndex !== i && (
                        <button
                          type="button"
                          onClick={() => setSigningFileIndex(i)}
                          className="whitespace-nowrap font-medium text-brand-brown hover:underline"
                        >
                          ✍️ Sign this PDF
                        </button>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="font-medium text-[#DC2626] hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {signingFileIndex === i && (
                      <div className="mt-2">
                        <PDFSigner
                          file={f}
                          onSaved={handleSignatureSaved}
                          onCancel={() => setSigningFileIndex(null)}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
                  }}
                  className="flex h-10 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-brand-border text-xs text-brand-muted hover:bg-[#F9F8F6]"
                >
                  📎 Click to attach files or drag &amp; drop
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            )}

            {signSuccess && <p className="mt-2 text-sm text-green-700">ลายเซ็นบันทึกแล้ว</p>}
          </section>

          {/* Approval Timeline */}
          <section>
            <h3 className="mm-section-label">Approval Timeline</h3>
            {request.status === "REJECTED" && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-800">Rejected at {request.rejected_stage ?? "-"}</p>
                <p className="text-red-700">
                  by {request.rejected_by ?? "-"} — {formatDate(request.rejected_at)}
                </p>
                <p className="mt-1 text-red-700">Reason: {request.reject_reason ?? "-"}</p>
              </div>
            )}
            <div className="flex items-start justify-between gap-1 overflow-x-auto pb-1">
              {timeline.map((step, i) => (
                <div key={step.key} className="flex min-w-[110px] flex-1 flex-col items-center px-1 text-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${STEP_CIRCLE_CLASS[step.state]}`}
                  >
                    {step.state === "done" ? "✓" : step.state === "skipped" ? "–" : i + 1}
                  </div>
                  <div className={`mt-1 text-xs font-medium ${step.state === "current" ? "text-brand-brown" : "text-brand-dark"}`}>
                    {step.label}
                  </div>
                  {step.detail && <div className="mt-0.5 text-[10px] text-brand-muted">{step.detail}</div>}
                </div>
              ))}
            </div>
          </section>

          {/* Rejection History */}
          {request.resubmit_count > 0 && request.rejection_history.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                className="text-sm font-medium text-brand-brown hover:underline"
              >
                {showHistory ? "Hide" : "Show"} Rejection History ({request.rejection_history.length})
              </button>
              {showHistory && (
                <ul className="mt-2 space-y-1 rounded-md border border-brand-border p-3 text-xs text-brand-dark">
                  {request.rejection_history.map((h, i) => (
                    <li key={i}>
                      [{h.stage}] {formatDate(h.rejected_at)} by {h.actor_email}: {h.reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            </>
          )}
        </div>

        {!fullEditMode && (actions || onSaveChanges || footerExtra) && (
          <div className="flex items-center justify-between gap-2 border-t border-[#F0EAE0] px-6 py-4">
            <div>{footerExtra}</div>
            <div className="flex gap-2">
              {actions}
              {onSaveChanges && (
                <button onClick={handleSave} disabled={saving} className="mm-btn-primary">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
