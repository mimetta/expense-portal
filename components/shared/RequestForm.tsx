"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RequiredMark from "@/components/shared/RequiredMark";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  BANK_OPTIONS,
  CARD_TYPES,
  DEPARTMENT_ABBREV,
  DEPARTMENTS,
  DOCUMENT_TYPES,
  EXPENSE_TYPES,
  PAYMENT_METHODS,
  PETTY_CASH_LABEL,
  TRAVEL_BY_OPTIONS,
  TRAVEL_EXPENSE_LABEL,
  TRAVEL_RATE_PER_KM,
  TRAVEL_REQUIRED_DOCS,
  getExpenseTypeConfig,
} from "@/lib/constants";
import { computeTotals } from "@/lib/totals";
import { formatCurrency } from "@/lib/format";
import type {
  CategoryRow,
  CompanyRow,
  ExpenseRequest,
  FileEntry,
  PettyCashCustodianRow,
  ProductRow,
  RequestItem,
  RoleRow,
  SupplierRow,
} from "@/types/database";

function currentBudgetPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const emptyItem = (): RequestItem => ({
  description: "",
  amount_net: 0,
  vat_rate: 7,
  wht_rate: 0,
  cat_l1: "",
  cat_l2: "",
  product_code: "",
  segment: "",
});

// Matches the "attachments" Supabase Storage bucket's own file_size_limit
// (see app/api/upload/route.ts) — files go to real Storage now, not inline
// base64 (see CLAUDE.md "File Storage": "drop the size cap" once real
// upload is wired up — raised, not literally dropped, since an unbounded
// single upload is still worth capping client-side before it's attempted).
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Formats a companies row for the "Use for company" dropdown, e.g.
// "ONEST — Mimetta Co., Ltd.".
function companyOptionLabel(c: CompanyRow): string {
  return `${c.bu} — ${c.name_en}`;
}

// Formats a petty_cash_custodians row for the "Petty cash holder" dropdown,
// e.g. "Somchai (Mimetta Co., Ltd. · Marketing)".
function custodianOptionLabel(c: PettyCashCustodianRow): string {
  return `${c.name} (${c.company} · ${c.segment})`;
}

const DRAFT_AUTOSAVE_MS = 60_000;

// departmentOptions is a plain string[] fetched from the DB (not the typed
// Department union), so this looks the abbreviation up defensively.
function departmentAbbrev(d: string): string | undefined {
  return (DEPARTMENT_ABBREV as Record<string, string>)[d];
}

function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// Credit-type documents are due to Accounting by the 15th of the current
// month — see the orange deadline banner in the Attachments section below.
function creditDeadlineMessage(): string {
  const remaining = 15 - new Date().getDate();
  if (remaining >= 0) {
    return `⚠️ กรุณาส่งเอกสารให้ฝ่ายบัญชีภายในวันที่ 15 ของเดือน — เหลืออีก ${remaining} วัน`;
  }
  return "⚠️ เลยกำหนดส่งเอกสารวันที่ 15 แล้ว กรุณาติดต่อฝ่ายบัญชี";
}

// Uploads one picked File directly from the browser to the private
// "attachments" Supabase Storage bucket, via a signed upload URL/token
// minted by POST /api/upload/signed-upload-url — the file bytes never pass
// through a Vercel serverless function, only the small JSON token
// request/response does. Replaces the old fileToEntry() base64 conversion,
// the Google Drive upload that briefly replaced that, and then the
// FormData-through-POST-/api/upload proxy that replaced Drive — that
// proxy route is still in place (see app/api/upload/route.ts) but no
// longer called from here, because it relayed the whole file through the
// function and silently 413'd on anything over Vercel's ~4.5MB request
// body limit. Historical requests may still carry base64 `data:` URLs
// (from before any Storage-based upload existed) or drive.google.com URLs
// (from the Drive-based build); both are left as-is, not migrated.
async function uploadFileEntry(
  file: File,
  requestId: string,
  budgetPeriod: string,
  documentType: string,
): Promise<FileEntry> {
  const tokenRes = await fetch("/api/upload/signed-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      budgetPeriod,
      documentType,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    }),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody.success) {
    console.error("[upload] failed to get signed upload URL:", tokenRes.status, tokenBody);
    const detail = [tokenBody.error, tokenBody.hint].filter(Boolean).join(" — ");
    throw new Error(detail || `Failed to prepare upload for ${file.name} (HTTP ${tokenRes.status})`);
  }
  const { path, token } = tokenBody as { path: string; token: string };

  const supabase = createBrowserSupabaseClient();
  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) {
    console.error("[upload] direct-to-storage upload failed:", uploadError);
    throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
  }

  // uploadToSignedUrl only returns { path, fullPath } — no readable URL —
  // so mint the initial one through the same route every later re-open
  // already uses (GET /api/upload/signed-url), rather than adding a
  // second URL-minting path just for this first read.
  const url = await resolveFileUrl({ name: file.name, url: "", path, size: file.size, doc_type: documentType });

  return {
    name: file.name,
    url,
    path,
    size: file.size,
    doc_type: documentType,
  };
}

// Re-signs a "attachments"-bucket FileEntry if it has a `path` — the url
// stored at upload time is only valid for 7 days (see
// app/api/upload/route.ts), so anything used well after that (opening the
// file, or PDFSigner.tsx fetching it to sign) needs a fresh one rather
// than trusting the stored `url`. Files with no `path` (legacy base64
// `data:` URLs, or public-bucket URLs like signed-documents/signatures)
// resolve to their existing `url` unchanged.
export async function resolveFileUrl(f: FileEntry): Promise<string> {
  if (f.path) {
    try {
      const res = await fetch(`/api/upload/signed-url?path=${encodeURIComponent(f.path)}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) return body.url;
    } catch {
      // fall through to the possibly-stale stored url below
    }
  }
  return f.url;
}

export async function openStoredFile(f: FileEntry) {
  const url = await resolveFileUrl(f);
  window.open(url, "_blank", "noopener,noreferrer");
}

const inputClass = "mm-input";
const cellClass =
  "h-9 rounded-md border border-brand-border bg-white px-2 text-sm text-brand-dark focus:border-brand-brown focus:outline-none";
const labelClass = "mb-1.5 block text-[13px] font-medium text-[#374151]";

// Column widths shared between the header row and every item row so labels
// stay aligned with their cells while the table scrolls horizontally.
const COL = {
  segment: { flex: "0 0 150px" },
  travelBy: { flex: "0 0 170px" },
  distanceKm: { flex: "0 0 110px" },
  catL1: { flex: "0 0 150px" },
  catL2: { flex: "0 0 130px" },
  itemField: { flex: "0 0 130px" },
  productCode: { flex: "0 0 110px" },
  description: { flex: "1 1 200px", minWidth: 200 },
  netAmount: { flex: "0 0 120px" },
  vat: { flex: "0 0 80px" },
  wht: { flex: "0 0 80px" },
  lineTotal: { flex: "0 0 100px" },
  remove: { flex: "0 0 64px" },
} as const;

export interface RequestFormPayload {
  bu: string;
  expense_type: string;
  urgent_reason?: string;
  department: string;
  budget_period: string;
  product?: string;
  cat_l1?: string;
  cat_l2?: string;
  items: RequestItem[];
  requires_po: boolean;
  supplier_name?: string;
  pay_method?: string;
  bank_name?: string;
  card_type?: string;
  account_no?: string;
  credit_term_days?: number;
  due_date?: string;
  slip_receiver_email?: string;
  files_folder_url?: string;
  files_json: FileEntry[];
  use_for_company?: string;
  petty_cash_holder_email?: string;
  procurement_fills_payment?: boolean;
}

export interface RequestFormInitial {
  requesterName: string;
  chapter: string | null;
  bu: string;
  department: string;
  expenseType: string;
  urgentReason: string;
  budgetPeriod: string;
  product: string;
  requiresPo: boolean;
  items: RequestItem[];
  supplierName: string;
  payMethod: string;
  bankName: string;
  cardType: string;
  accountNo: string;
  creditTermDays: number | "";
  dueDate: string;
  slipReceiverEmail: string;
  filesFolderUrl: string;
  files: FileEntry[];
  useForCompany: string;
  pettyCashHolderEmail: string;
  procurementFillsPayment: boolean;
}

// Shared by My Requests' Edit & Resubmit / Edit modal (app/my/page.tsx) and
// RequestDetailModal.tsx's in-place edit mode — both pre-fill this exact
// form from an existing request, so this conversion lives once here rather
// than being copy-pasted at each call site.
export function requestToFormInitial(r: ExpenseRequest): Partial<RequestFormInitial> {
  return {
    requesterName: r.requester_name,
    chapter: r.chapter,
    bu: r.bu,
    department: r.department,
    expenseType: r.expense_type,
    urgentReason: r.urgent_reason ?? "",
    budgetPeriod: r.budget_period,
    product: r.product ?? "",
    requiresPo: r.requires_po,
    items: r.items_json,
    supplierName: r.supplier_name ?? "",
    payMethod: r.pay_method ?? "",
    bankName: r.bank_name ?? "",
    cardType: r.card_type ?? "",
    accountNo: r.account_no ?? "",
    creditTermDays: r.credit_term_days ?? "",
    dueDate: r.due_date ?? "",
    slipReceiverEmail: r.slip_receiver_email ?? "",
    filesFolderUrl: r.files_folder_url ?? "",
    files: r.files_json,
    useForCompany: r.use_for_company ?? "",
    pettyCashHolderEmail: r.petty_cash_holder_email ?? "",
    procurementFillsPayment: r.procurement_fills_payment ?? false,
  };
}

interface RequestFormProps {
  // Omitted entirely for create mode (/submit). Provided for edit mode —
  // pre-fills every field from the existing request. request_id/
  // requester_email/timestamp are deliberately not part of this shape:
  // they're immutable and never round-tripped through the form.
  initial?: Partial<RequestFormInitial>;
  title?: string;
  banner?: React.ReactNode;
  // Return value is only meaningful for create mode (see uploadContext
  // below): returning { requestId } tells the form the request now exists
  // for real, so any files picked before submission (necessarily with no
  // request to upload into yet) can now be uploaded and attached.
  // Edit-mode callers can keep resolving to void, same as before.
  onSubmit: (payload: RequestFormPayload) => Promise<{ requestId?: string } | void>;
  submitLabel?: string;
  submittingLabel?: string;
  secondaryAction?: {
    label: string;
    busyLabel: string;
    onClick: (payload: RequestFormPayload) => Promise<void>;
  };
  // Draft save/autosave — only /submit sets this (not the Edit & Resubmit
  // modal or in-place edit mode), an explicit flag rather than inferring
  // from `initial`'s presence since edit mode also passes `initial`. See
  // CLAUDE.md-style note on owner_edit needing its own explicit flag for
  // the same kind of ambiguity.
  enableDrafts?: boolean;
  // Draft this form was loaded from ("Continue" in My Requests > Drafts),
  // so autosave/Save draft update that same row instead of creating a new
  // one, and so a successful submit can delete it.
  draftId?: number | null;
  onDraftSaved?: (draftId: number) => void;
  onDraftDeleted?: () => void;
  // Set by every edit-mode caller (the request already has a real id) —
  // enables upload-immediately-on-pick. Omitted for create mode (/submit):
  // an attachment's storage path is namespaced by the real request_id (see
  // app/api/upload/route.ts), which doesn't exist until POST /api/requests
  // succeeds, so picked files are held as plain File objects and only
  // uploaded (then attached via a follow-up PATCH) once onSubmit resolves
  // with a real id.
  uploadContext?: { requestId: string };
  // Called once the whole submit — including, in create mode, uploading
  // any picked files and attaching them — has fully succeeded. Only
  // /submit uses this (to navigate away); edit-mode callers already close
  // their own modal/panel from inside onSubmit itself.
  onComplete?: () => void;
}

export default function RequestForm({
  initial,
  title = "Submit Expense Request",
  banner,
  onSubmit,
  submitLabel = "Submit Request",
  submittingLabel = "Submitting...",
  secondaryAction,
  enableDrafts = false,
  draftId: initialDraftId = null,
  onDraftSaved,
  onDraftDeleted,
  uploadContext,
  onComplete,
}: RequestFormProps) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [custodians, setCustodians] = useState<PettyCashCustodianRow[]>([]);
  const [currentUser, setCurrentUser] = useState<
    { email: string; name: string; chapter?: string | null; allRoles?: RoleRow[] } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondaryBusy, setSecondaryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Basic Info ---------------------------------------------------------
  const [bu, setBu] = useState<string>(initial?.bu ?? "ONEST");
  // null = still loading from /api/departments; set once loaded (or once
  // the hardcoded DEPARTMENTS fallback kicks in on fetch failure/empty
  // result). Segment no longer has a single top-level value — it's picked
  // per item row (see items state below) — this list just feeds every
  // row's own Segment dropdown, same source as before.
  const [departmentOptions, setDepartmentOptions] = useState<string[] | null>(null);
  const [expenseType, setExpenseType] = useState<string>(initial?.expenseType ?? EXPENSE_TYPES[0].label);
  const [urgentReason, setUrgentReason] = useState(initial?.urgentReason ?? "");
  const [budgetPeriod, setBudgetPeriod] = useState(initial?.budgetPeriod ?? currentBudgetPeriod());
  const [product, setProduct] = useState(initial?.product ?? "");
  const [useForCompany, setUseForCompany] = useState(initial?.useForCompany ?? "");
  const [pettyCashHolderEmail, setPettyCashHolderEmail] = useState(initial?.pettyCashHolderEmail ?? "");
  const [pettyCashUsage, setPettyCashUsage] = useState<number | null>(null);

  const expenseConfig = getExpenseTypeConfig(expenseType);
  const isPettyCash = expenseType === PETTY_CASH_LABEL;
  const isTravel = expenseType === TRAVEL_EXPENSE_LABEL;

  // Business Unit is always auto-filled and read-only — never a free
  // choice. Resolution: the first non-"*" bu_scope value across the user's
  // roles (covers both "one specific value everywhere" and "several roles,
  // some scoped to a specific BU" — same rule either way), or "ONEST" as
  // the default if every role is genuinely unrestricted ("*").
  const resolvedBu = useMemo((): string => {
    const scopes = currentUser?.allRoles?.map((r) => r.bu_scope) ?? [];
    for (const scope of scopes) {
      if (scope === "*") continue;
      const first = scope.split(",").map((s) => s.trim()).filter(Boolean)[0];
      if (first) return first;
    }
    return "ONEST";
  }, [currentUser]);

  useEffect(() => {
    if (initial?.bu) return; // edit mode already has a concrete value
    setBu(resolvedBu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedBu]);

  // Per-item Segment + Petty Cash: Retail moves Branch from a single
  // top-level field to a required per-row column; R&D does the same for
  // Product, but optional. Generalizes the old single-department-wide
  // perItemFieldMode to a per-row check now that Segment lives per item.
  const perItemFieldModeFor = (segment: string | undefined): "branch" | "product" | null => {
    if (!isPettyCash) return null;
    if (segment === "Retail") return "branch";
    if (segment === "R&D") return "product";
    return null;
  };

  // --- PO required ---------------------------------------------------------
  const [requiresPo, setRequiresPo] = useState(initial?.requiresPo ?? (expenseConfig?.defaultRequiresPo ?? true));
  const skipFirstRpoReset = useRef(true);
  useEffect(() => {
    // Skip on mount so a pre-filled `initial.requiresPo` (edit mode) isn't
    // immediately clobbered by the expense type's default — only actual
    // user-driven expense type changes should reset it.
    if (skipFirstRpoReset.current) {
      skipFirstRpoReset.current = false;
      return;
    }
    setRequiresPo(expenseConfig?.defaultRequiresPo ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseType]);

  // --- Items ---------------------------------------------------------
  // Falls back to the old flat `initial.department` for any pre-existing
  // item that predates this feature (no items_json[].segment yet) — so
  // opening an old request for editing doesn't silently blank out Segment.
  const [items, setItems] = useState<RequestItem[]>(
    initial?.items && initial.items.length > 0
      ? initial.items.map((it) => ({ ...it, segment: it.segment || initial.department || "" }))
      : [emptyItem()],
  );

  // requests.department (dept_config matching / BO scope filtering) is
  // populated from the first item's segment when items span more than one
  // — same "first item wins" convention already used for cat_l1/cat_l2 in
  // mixed-category multi-item requests (see CLAUDE.md "Multi-Item
  // Requests"). Also drives the top-level Product/Branch field below for
  // non-Petty-Cash Retail/R&D requests, since that field is still a single
  // top-level value, not per-item.
  const primarySegment = items[0]?.segment || "";

  // --- Payment Details ---------------------------------------------------------
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [payMethod, setPayMethod] = useState(initial?.payMethod ?? "");
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [cardType, setCardType] = useState(initial?.cardType ?? "");
  const [accountNo, setAccountNo] = useState(initial?.accountNo ?? "");
  const [creditTermDays, setCreditTermDays] = useState<number | "">(initial?.creditTermDays ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [slipReceiverEmail, setSlipReceiverEmail] = useState(initial?.slipReceiverEmail ?? "");
  const [procurementFillsPayment, setProcurementFillsPayment] = useState(
    initial?.procurementFillsPayment ?? false,
  );

  // --- Attachments ---------------------------------------------------------
  const [filesFolderUrl, setFilesFolderUrl] = useState(initial?.filesFolderUrl ?? "");
  // Already-uploaded files — real Storage-hosted entries (uploadContext
  // mode), or pre-existing base64/Drive entries carried over from an
  // existing request.
  const [files, setFiles] = useState<FileEntry[]>(initial?.files ?? []);
  // Create-mode only (no uploadContext yet): files picked before the
  // request exists, held as plain File objects until onSubmit resolves
  // with a real request_id — see handleSubmit below.
  const [pendingFiles, setPendingFiles] = useState<{ file: File; docType: string }[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => {
        if (!res.ok) throw new Error("departments fetch failed");
        return res.json();
      })
      .then((data) => {
        const loaded: string[] = data.departments ?? [];
        setDepartmentOptions(loaded.length > 0 ? loaded : [...DEPARTMENTS]);
      })
      .catch(() => setDepartmentOptions([...DEPARTMENTS]));
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []));
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []));
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []));
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data) => setRoles(data.roles ?? []));
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(data.companies ?? []));
    fetch("/api/petty-cash-custodians")
      .then((res) => res.json())
      .then((data) => setCustodians(data.custodians ?? []));
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          setSlipReceiverEmail((prev) => prev || data.user.email);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch current-month usage for the selected Petty cash holder's bar —
  // refetches whenever the selection changes.
  useEffect(() => {
    if (!pettyCashHolderEmail) {
      setPettyCashUsage(null);
      return;
    }
    fetch(`/api/petty-cash-usage?holder_email=${encodeURIComponent(pettyCashHolderEmail)}`)
      .then((res) => res.json())
      .then((data) => setPettyCashUsage(typeof data.used === "number" ? data.used : 0))
      .catch(() => setPettyCashUsage(null));
  }, [pettyCashHolderEmail]);

  // '*' on bu/segment is a wildcard meaning "applies to every BU/segment" —
  // same convention as dept_config and BO role scopes elsewhere in the app.
  // Segment now lives per item row (not a single top-level value), so this
  // takes the row's own segment instead of closing over one shared value.
  const catL1OptionsFor = (segment: string | undefined) =>
    Array.from(
      new Set(
        categories
          .filter(
            (c) =>
              (c.bu === "*" || c.bu === bu) &&
              (c.department === "*" || c.department === segment) &&
              c.cat_l1,
          )
          .map((c) => c.cat_l1 as string),
      ),
    );

  const catL2OptionsFor = (segment: string | undefined, cat_l1: string | undefined) =>
    Array.from(
      new Set(
        categories
          .filter(
            (c) =>
              (c.bu === "*" || c.bu === bu) &&
              (c.department === "*" || c.department === segment) &&
              (!cat_l1 || c.cat_l1 === cat_l1) &&
              c.cat_l2,
          )
          .map((c) => c.cat_l2 as string),
      ),
    );

  const productOptionsFor = (dept: string) =>
    Array.from(
      new Set(
        products
          .filter((p) => p.department === dept && (!p.bu || p.bu === bu))
          .map((p) => p.product_name),
      ),
    );


  const filteredSuppliers = useMemo(() => {
    const q = supplierName.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, supplierName]);

  const distinctReceiverEmails = useMemo(
    () => Array.from(new Set(roles.map((r) => r.email))).sort(),
    [roles],
  );

  const totals = useMemo(() => {
    try {
      return computeTotals(items);
    } catch {
      return { amount_net: 0, vat_amount: 0, wht_amount: 0, total: 0 };
    }
  }, [items]);

  const updateItem = (idx: number, patch: Partial<RequestItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const itemsScrollRef = useRef<HTMLDivElement>(null);
  const scrollItems = (delta: number) =>
    itemsScrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });

  const handleSupplierChange = (name: string) => {
    setSupplierName(name);
    const match = suppliers.find((s) => s.name === name);
    if (match) {
      if (match.payment_method) setPayMethod(match.payment_method);
      if (match.bank_name) setBankName(match.bank_name);
      if (match.account_no) setAccountNo(match.account_no);
    }
  };

  const handleFiles = async (fileList: FileList) => {
    setAttachmentError(null);
    const picked = Array.from(fileList).filter((file) => {
      if (file.size > MAX_FILE_BYTES) {
        alert(`${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024}MB and can't be attached.`);
        return false;
      }
      return true;
    });
    if (picked.length === 0) return;

    if (uploadContext) {
      // Edit mode — the request already has a real id, so upload straight
      // to Storage now instead of waiting for submit.
      setUploadStatus(`Uploading files... (0/${picked.length})`);
      for (let i = 0; i < picked.length; i++) {
        try {
          const entry = await uploadFileEntry(picked[i], uploadContext.requestId, budgetPeriod, "");
          setFiles((prev) => [...prev, entry]);
        } catch (err) {
          setAttachmentError(err instanceof Error ? err.message : `Failed to upload ${picked[i].name}`);
          break;
        }
        setUploadStatus(`Uploading files... (${i + 1}/${picked.length})`);
      }
      setUploadStatus(null);
    } else {
      // Create mode — no request to upload into yet; stage for upload at
      // submit time (see handleSubmit).
      setPendingFiles((prev) => [...prev, ...picked.map((file) => ({ file, docType: "" }))]);
    }
  };

  const updateFile = (idx: number, patch: Partial<FileEntry>) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const updatePendingFile = (idx: number, docType: string) =>
    setPendingFiles((prev) => prev.map((p, i) => (i === idx ? { ...p, docType } : p)));
  const removePendingFile = (idx: number) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  // Required-doc checklists (below) should reflect files picked but not
  // yet uploaded too, not just already-uploaded ones.
  const isDocTypeAttached = (docLabel: string) =>
    files.some((f) => f.doc_type === docLabel) || pendingFiles.some((p) => p.docType === docLabel);

  const validate = (): string | null => {
    if (expenseConfig?.isUrgent && !urgentReason.trim()) {
      return "Urgent reason is required for this expense type";
    }
    if (!useForCompany) {
      return "Use for company is required";
    }
    if (isPettyCash && !pettyCashHolderEmail) {
      return "Petty cash holder is required";
    }
    if (items.some((it) => !it.segment || !it.cat_l1 || !it.description.trim())) {
      return "Every item needs a Segment, Category L1, and a Description";
    }
    if (items.some((it) => perItemFieldModeFor(it.segment) === "branch" && !it.product)) {
      return "Every item needs a Branch";
    }
    if (isTravel && items.some((it) => !it.travel_by)) {
      return "Every item needs a Travel by selection";
    }
    // Payment Details fields are all required unless Procurement is taking
    // over entirely (procurement_fills_payment) — each check still only
    // applies where that field is actually shown for this expense type
    // (hidePaymentSection/hideBankFields/hideDueDate), same as the
    // visibility rules the JSX below already uses.
    if (!expenseConfig?.hidePaymentSection && !procurementFillsPayment) {
      if (!supplierName.trim()) {
        return "Supplier/Payee is required";
      }
      if (!payMethod) {
        return "Payment Method is required";
      }
      if (!expenseConfig?.hideBankFields) {
        if (showBankName && !bankName) {
          return "Bank Name is required";
        }
        if (!accountNo.trim()) {
          return "Account No / Card No is required";
        }
      }
      if (!expenseConfig?.hideDueDate && !dueDate) {
        return "Due Date is required";
      }
    }
    return null;
  };

  const buildPayload = (): RequestFormPayload => ({
    bu,
    expense_type: expenseType,
    urgent_reason: expenseConfig?.isUrgent ? urgentReason : undefined,
    // requests.department is still a single flat column (dept_config
    // matching / BO scope filtering) — populated from the first item's
    // Segment now that Segment is per-item, same "first item wins"
    // convention already used for cat_l1/cat_l2 below.
    department: items[0]?.segment || "",
    budget_period: budgetPeriod,
    // Branch/Product lives per-item (items[].product) when any row is in
    // branch/product mode — the top-level field is only meaningful for
    // non-Petty-Cash Retail/R&D requests, keyed off the first item's
    // segment (see primarySegment).
    product: isPettyCash ? undefined : product || undefined,
    cat_l1: items[0]?.cat_l1 || undefined,
    cat_l2: items[0]?.cat_l2 || undefined,
    items,
    requires_po: requiresPo,
    supplier_name: supplierName || undefined,
    pay_method: payMethod || undefined,
    bank_name: bankName || undefined,
    card_type: cardType || undefined,
    account_no: accountNo || undefined,
    credit_term_days: creditTermDays === "" ? undefined : creditTermDays,
    due_date: dueDate || undefined,
    slip_receiver_email: slipReceiverEmail || undefined,
    files_folder_url: filesFolderUrl || undefined,
    files_json: files,
    use_for_company: useForCompany || undefined,
    petty_cash_holder_email: isPettyCash ? pettyCashHolderEmail || undefined : undefined,
    procurement_fills_payment: procurementFillsPayment,
  });

  // --- Draft save/autosave (enableDrafts only — see prop doc above) --------
  const [draftId, setDraftId] = useState<number | null>(initialDraftId);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const draftSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftTitle = () => {
    const seg = items[0]?.segment;
    return expenseType && seg ? `${expenseType} — ${seg}` : expenseType || "Untitled draft";
  };

  const hasAnyDraftData = () =>
    items.some((it) => it.description.trim() || it.cat_l1 || it.amount_net > 0) ||
    !!useForCompany ||
    !!pettyCashHolderEmail ||
    !!supplierName ||
    !!urgentReason.trim();

  const saveDraft = async () => {
    if (!enableDrafts) return;
    setDraftStatus("saving");
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draftId ?? undefined,
          title: draftTitle(),
          form_data: buildPayload(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save draft");
      const body = await res.json();
      const savedId = body.draft?.id as number | undefined;
      if (savedId) {
        setDraftId(savedId);
        onDraftSaved?.(savedId);
      }
      setDraftStatus("saved");
      if (draftSavedTimeoutRef.current) clearTimeout(draftSavedTimeoutRef.current);
      draftSavedTimeoutRef.current = setTimeout(() => setDraftStatus("idle"), 2000);
    } catch {
      setDraftStatus("idle");
    }
  };

  // Always-fresh ref so the fixed 60s interval below reads current state at
  // fire time rather than whatever was in scope when the interval was
  // created (a plain dependency-array effect would otherwise have to
  // recreate the interval — and reset its 60s countdown — on every
  // keystroke).
  const autosaveTickRef = useRef<() => void>(() => {});
  autosaveTickRef.current = () => {
    if (hasAnyDraftData()) saveDraft();
  };
  useEffect(() => {
    if (!enableDrafts) return;
    const interval = setInterval(() => autosaveTickRef.current(), DRAFT_AUTOSAVE_MS);
    return () => clearInterval(interval);
  }, [enableDrafts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAttachmentError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const result = await onSubmit(buildPayload());
      // A submitted request is no longer a draft — clean up the row it was
      // loaded from, if any.
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE" }).catch(() => {});
        onDraftDeleted?.();
      }

      // Create mode only: the request now has a real id, so any files
      // picked before submission (see handleFiles above) can finally be
      // uploaded and attached. Deviates from "upload before creating the
      // request" — the storage path is namespaced by the real
      // EXP-YYYY-MM-NNNNNN id, which Postgres only assigns as part of a
      // successful insert, so that literal ordering isn't achievable; this
      // is the closest equivalent (upload immediately once the id exists,
      // as the last step of the same submit action).
      const requestId = result?.requestId;
      if (requestId && pendingFiles.length > 0) {
        setUploadStatus(`Uploading files... (0/${pendingFiles.length})`);
        const uploaded: FileEntry[] = [...files];
        try {
          for (let i = 0; i < pendingFiles.length; i++) {
            const { file, docType } = pendingFiles[i];
            const entry = await uploadFileEntry(file, requestId, budgetPeriod, docType);
            uploaded.push(entry);
            setUploadStatus(`Uploading files... (${i + 1}/${pendingFiles.length})`);
          }
          const patchRes = await fetch(`/api/requests/${requestId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner_edit: true, files_json: uploaded }),
          });
          if (!patchRes.ok) {
            const patchBody = await patchRes.json().catch(() => ({}));
            throw new Error(patchBody.error ?? "Failed to attach uploaded files to the request");
          }
          setFiles(uploaded);
          setPendingFiles([]);
        } catch (uploadErr) {
          // The request itself was already created successfully above —
          // only the attachment step failed, so say so explicitly rather
          // than implying the whole submission was rolled back.
          setAttachmentError(
            `Request ${requestId} was created, but attaching files failed: ${
              uploadErr instanceof Error ? uploadErr.message : "unknown error"
            }. Open it from My Requests to retry.`,
          );
          setUploadStatus(null);
          return;
        }
        setUploadStatus(null);
      }

      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSecondary = async () => {
    if (!secondaryAction) return;
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSecondaryBusy(true);
    try {
      await secondaryAction.onClick(buildPayload());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSecondaryBusy(false);
    }
  };

  const showBankName = payMethod === "โอนธนาคาร" || payMethod === "บัตรเครดิต/เดบิต";
  const showCardType = payMethod === "บัตรเครดิต/เดบิต";

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-3">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="mm-page-title">{title}</h1>
        {enableDrafts && (
          <div className="flex items-center gap-2">
            {draftStatus === "saved" && <span className="text-xs text-brand-muted">Saved</span>}
            <button
              type="button"
              onClick={saveDraft}
              disabled={draftStatus === "saving"}
              className="mm-btn-secondary mm-btn-sm"
            >
              {draftStatus === "saving" ? "Saving..." : "Save draft"}
            </button>
          </div>
        )}
      </div>

      {banner}

      {/* ===================== Basic Info ===================== */}
      <div className="mm-card">
        <h2 className="mm-section-label">Basic Info</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Business unit<RequiredMark /> <span aria-hidden>🔒</span>
            </label>
            <input className={`${inputClass} bg-[#F9F8F6]`} value={bu} disabled readOnly />
          </div>
          <div>
            <label className={labelClass}>Requester Name</label>
            <input
              className={`${inputClass} bg-[#F9F8F6]`}
              value={initial?.requesterName ?? currentUser?.name ?? ""}
              disabled
              readOnly
            />
          </div>
          <div>
            <label className={labelClass}>Chapter</label>
            <input
              className={`${inputClass} bg-[#F9F8F6]`}
              value={initial?.chapter ?? currentUser?.chapter ?? ""}
              placeholder="— not assigned —"
              disabled
              readOnly
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Expense Type<RequiredMark /></label>
          <select
            className={inputClass}
            value={expenseType}
            onChange={(e) => setExpenseType(e.target.value)}
          >
            {EXPENSE_TYPES.map((t) => (
              <option key={t.label} value={t.label}>{t.label}</option>
            ))}
          </select>
        </div>

        {expenseConfig?.isUrgent && (
          <div className="mt-4">
            <label className={labelClass}>Urgent Reason<RequiredMark /></label>
            <textarea
              className={inputClass}
              value={urgentReason}
              onChange={(e) => setUrgentReason(e.target.value)}
              required
            />
          </div>
        )}

        <div className="mt-4">
          <label className={labelClass}>
            Use for company<RequiredMark />
            {isPettyCash && pettyCashHolderEmail && <span className="ml-1">🔒</span>}
          </label>
          {isPettyCash && pettyCashHolderEmail ? (
            <input
              className={`${inputClass} bg-[#F9F8F6]`}
              value={
                companies.find((c) => c.bu === useForCompany)
                  ? companyOptionLabel(companies.find((c) => c.bu === useForCompany)!)
                  : useForCompany
              }
              disabled
              readOnly
            />
          ) : (
            <select
              className={inputClass}
              value={useForCompany}
              onChange={(e) => setUseForCompany(e.target.value)}
              required
            >
              <option value="">Select...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.bu}>{companyOptionLabel(c)}</option>
              ))}
            </select>
          )}
          <p className="mt-1 text-xs text-brand-subtle">
            {isPettyCash && pettyCashHolderEmail
              ? "Auto-filled from the selected Petty cash holder's company"
              : "Which company is this expense for"}
          </p>
        </div>

        {isPettyCash && (
          <div
            className="mt-4 rounded-md border p-3"
            style={{ background: "#EFF6FF", borderColor: "#BFDBFE" }}
          >
            <label className={labelClass}>Petty cash holder<RequiredMark /></label>
            <select
              className={inputClass}
              value={pettyCashHolderEmail}
              onChange={(e) => {
                const email = e.target.value;
                setPettyCashHolderEmail(email);
                // Auto-fill Use for company from the selected custodian's
                // company (petty_cash_custodians.company is a company NAME,
                // e.g. "Mimetta Co., Ltd.", not the bu-code value this
                // field actually stores — so this maps name -> companies
                // row -> bu rather than writing the name straight through).
                const custodian = custodians.find((c) => c.email === email);
                if (custodian) {
                  const matchedCompany = companies.find((c) => c.name_en === custodian.company);
                  if (matchedCompany) setUseForCompany(matchedCompany.bu);
                }
              }}
              required
            >
              <option value="">Select...</option>
              {custodians.map((c) => (
                <option key={c.id} value={c.email}>{custodianOptionLabel(c)}</option>
              ))}
            </select>

            {pettyCashHolderEmail && pettyCashUsage !== null && (() => {
              const custodian = custodians.find((c) => c.email === pettyCashHolderEmail);
              const limit = custodian?.amount_limit ?? 0;
              const remaining = limit - pettyCashUsage;
              const pct = limit > 0 ? Math.min(100, (pettyCashUsage / limit) * 100) : 0;
              return (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                    <div className="h-full" style={{ width: `${pct}%`, background: "#BD5A2E" }} />
                  </div>
                  <p className="mt-1 text-xs text-brand-dark">
                    ฿{formatCurrency(pettyCashUsage)} / ฿{formatCurrency(limit)} used · Remaining: ฿
                    {formatCurrency(remaining)}
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        <div className="mt-4">
          <label className={labelClass}>Budget Period<RequiredMark /></label>
          <input
            type="month"
            className={inputClass}
            value={budgetPeriod}
            onChange={(e) => setBudgetPeriod(e.target.value)}
            required
          />
        </div>

        {!isPettyCash && primarySegment === "R&D" && (
          <div className="mt-4">
            <label className={labelClass}>Product (optional)</label>
            <select className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">-</option>
              {productOptionsFor("R&D").map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {productOptionsFor("R&D").length === 0 && (
              <p className="mt-1 text-xs text-brand-subtle">
                No R&amp;D products yet — add them in Settings &gt; Product/SKU Management.
              </p>
            )}
          </div>
        )}
        {!isPettyCash && primarySegment === "Retail" && (
          <div className="mt-4">
            <label className={labelClass}>Branch (optional)</label>
            <select className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="">-</option>
              {productOptionsFor("Retail").map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {productOptionsFor("Retail").length === 0 && (
              <p className="mt-1 text-xs text-brand-subtle">
                No branches yet — add them in Settings &gt; Product/SKU Management (Segment = Retail).
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===================== PO Required ===================== */}
      {!expenseConfig?.hidePoSection && (
        <div className="mm-card flex items-center gap-4 !py-3">
          <span className="text-sm font-medium text-brand-dark">Purchase Order Required?</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-brand-dark">
            <input
              type="radio"
              name="requires_po"
              checked={requiresPo}
              onChange={() => setRequiresPo(true)}
              className="h-3.5 w-3.5 accent-brand-brown"
            />
            Yes
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-brand-dark">
            <input
              type="radio"
              name="requires_po"
              checked={!requiresPo}
              onChange={() => setRequiresPo(false)}
              className="h-3.5 w-3.5 accent-brand-brown"
            />
            No
          </label>
        </div>
      )}

      {/* ===================== Expense Items ===================== */}
      <div className="mm-card">
        <div className="mm-section-label flex items-center justify-between !border-b-0 !pb-0">
          <span>Expense Items</span>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, emptyItem()])}
            className="mm-btn-secondary mm-btn-sm normal-case tracking-normal text-brand-brown"
          >
            + Add Expense Item
          </button>
        </div>
        <div className="mb-4 mt-3 border-b border-[#F0EAE0]" />

        <div className="mb-3 rounded-md border border-brand-border bg-[#F9F8F6] px-3 py-2 text-xs text-brand-dark">
          Amount is optional — Procurement จะกรอกเพิ่มตอนอัปโหลด PO | Category L1 และ Description จำเป็นต้องกรอก
        </div>

        <div className="relative" style={{ overflow: "visible" }}>
          <button
            type="button"
            aria-label="Scroll items left"
            onClick={() => scrollItems(-200)}
            style={{ left: -16 }}
            className="absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(159,131,97,0.4)] bg-[rgba(159,131,97,0.25)] text-lg leading-none text-brand-brown hover:bg-[rgba(159,131,97,0.5)]"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Scroll items right"
            onClick={() => scrollItems(200)}
            style={{ right: -16 }}
            className="absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(159,131,97,0.4)] bg-[rgba(159,131,97,0.25)] text-lg leading-none text-brand-brown hover:bg-[rgba(159,131,97,0.5)]"
          >
            ›
          </button>

          <div ref={itemsScrollRef} className="no-scrollbar overflow-x-auto">
            <div className="flex min-w-full gap-2 rounded-t-md border-b border-brand-border bg-[#F9F8F6] px-2 py-2 text-xs font-semibold text-brand-dark">
              <div style={COL.segment}>Segment<RequiredMark /></div>
              {isTravel && <div style={COL.travelBy}>Travel by<RequiredMark /></div>}
              {isTravel && <div style={COL.distanceKm}>Distance (km)</div>}
              <div style={COL.catL1}>Category L1<RequiredMark /></div>
              <div style={COL.catL2}>Category L2</div>
              {isPettyCash && <div style={COL.itemField}>Branch/Product</div>}
              <div style={COL.productCode}>Product Code</div>
              <div style={COL.description}>Description<RequiredMark /></div>
              <div style={COL.netAmount}>Net Amount (THB)</div>
              <div style={COL.vat}>VAT%</div>
              <div style={COL.wht}>WHT%</div>
              <div style={COL.lineTotal}>Line Total</div>
              <div style={COL.remove} />
            </div>

            <div className="space-y-2 pt-2">
              {items.map((item, idx) => {
                const lineTotal =
                  item.amount_net + (item.amount_net * item.vat_rate) / 100 -
                  (item.amount_net * item.wht_rate) / 100;
                const noCodeYet = item.product_code === null;
                const rowFieldMode = perItemFieldModeFor(item.segment);
                const isPersonalVehicle = item.travel_by === TRAVEL_BY_OPTIONS[0];

                return (
                  <div key={idx} className="flex items-start gap-2">
                    <div style={COL.segment}>
                      <select
                        className={`${cellClass} w-full`}
                        value={item.segment ?? ""}
                        onChange={(e) =>
                          updateItem(idx, { segment: e.target.value, cat_l1: "", cat_l2: "" })
                        }
                        disabled={departmentOptions === null}
                        required
                      >
                        <option value="">Select...</option>
                        {(departmentOptions ?? []).map((d) => (
                          <option key={d} value={d}>
                            {d}{departmentAbbrev(d) ? ` (${departmentAbbrev(d)})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    {isTravel && (
                      <div style={COL.travelBy}>
                        <select
                          className={`${cellClass} w-full`}
                          value={item.travel_by ?? ""}
                          onChange={(e) => {
                            const travelBy = e.target.value;
                            updateItem(idx, {
                              travel_by: travelBy,
                              amount_net:
                                travelBy === TRAVEL_BY_OPTIONS[0]
                                  ? (item.distance_km ?? 0) * TRAVEL_RATE_PER_KM
                                  : item.amount_net,
                            });
                          }}
                          required
                        >
                          <option value="">Select...</option>
                          {TRAVEL_BY_OPTIONS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {isTravel && isPersonalVehicle && (
                      <div style={COL.distanceKm}>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          className={`${cellClass} w-full`}
                          placeholder="0"
                          value={item.distance_km ?? ""}
                          onChange={(e) => {
                            const distanceKm = Number(e.target.value);
                            updateItem(idx, {
                              distance_km: distanceKm,
                              amount_net: distanceKm * TRAVEL_RATE_PER_KM,
                            });
                          }}
                        />
                      </div>
                    )}
                    {isTravel && !isPersonalVehicle && <div style={COL.distanceKm} />}
                    <div style={COL.catL1}>
                      <select
                        className={`${cellClass} w-full`}
                        value={item.cat_l1 ?? ""}
                        onChange={(e) => updateItem(idx, { cat_l1: e.target.value, cat_l2: "" })}
                        required
                      >
                        <option value="">Select...</option>
                        {catL1OptionsFor(item.segment).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={COL.catL2}>
                      <select
                        className={`${cellClass} w-full`}
                        value={item.cat_l2 ?? ""}
                        onChange={(e) => updateItem(idx, { cat_l2: e.target.value })}
                      >
                        <option value="">Select...</option>
                        {catL2OptionsFor(item.segment, item.cat_l1).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {isPettyCash && (
                      <div style={COL.itemField}>
                        {rowFieldMode ? (
                          <select
                            className={`${cellClass} w-full`}
                            value={item.product ?? ""}
                            onChange={(e) => updateItem(idx, { product: e.target.value })}
                            required={rowFieldMode === "branch"}
                          >
                            <option value="">Select...</option>
                            {productOptionsFor(item.segment ?? "").map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        ) : (
                          <div className={`${cellClass} flex w-full items-center text-brand-subtle`}>—</div>
                        )}
                      </div>
                    )}
                    <div style={COL.productCode}>
                      <input
                        list="product-codes"
                        className={`${cellClass} w-full`}
                        placeholder="SKU"
                        disabled={noCodeYet}
                        value={item.product_code ?? ""}
                        onChange={(e) => updateItem(idx, { product_code: e.target.value })}
                      />
                      <label className="mt-1 flex items-center gap-1 text-[11px] text-brand-muted">
                        <input
                          type="checkbox"
                          checked={noCodeYet}
                          onChange={(e) =>
                            updateItem(idx, { product_code: e.target.checked ? null : "" })
                          }
                        />
                        No code yet
                      </label>
                    </div>
                    <div style={COL.description}>
                      <input
                        className={`${cellClass} w-full`}
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateItem(idx, { description: e.target.value })}
                        required
                      />
                    </div>
                    <div style={COL.netAmount}>
                      {isTravel && isPersonalVehicle ? (
                        <div className={`${cellClass} flex w-full items-center font-medium text-brand-dark`}>
                          {formatCurrency(item.amount_net)} (auto)
                        </div>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`${cellClass} w-full`}
                          placeholder="0.00"
                          value={item.amount_net || ""}
                          onChange={(e) => updateItem(idx, { amount_net: Number(e.target.value) })}
                        />
                      )}
                    </div>
                    <div style={COL.vat} className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={`${cellClass} w-full`}
                        placeholder="0"
                        value={item.vat_rate}
                        onChange={(e) => updateItem(idx, { vat_rate: Number(e.target.value) })}
                      />
                      <span className="text-sm text-brand-dark">%</span>
                    </div>
                    <div style={COL.wht} className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={`${cellClass} w-full`}
                        placeholder="0"
                        value={item.wht_rate}
                        onChange={(e) => updateItem(idx, { wht_rate: Number(e.target.value) })}
                      />
                      <span className="text-sm text-brand-dark">%</span>
                    </div>
                    <div style={COL.lineTotal} className="pt-1.5 text-sm font-medium text-brand-dark">
                      {formatCurrency(lineTotal)}
                    </div>
                    <div style={COL.remove} className="pt-1.5">
                      <button
                        type="button"
                        disabled={items.length === 1}
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-sm font-medium text-[#DC2626] hover:underline disabled:opacity-30 disabled:hover:no-underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <datalist id="product-codes">
          {products.map((p) => p.sku_code && <option key={p.id} value={p.sku_code} />)}
        </datalist>

        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-brand-border pt-3 text-right">
          <div>
            <div className="text-xs text-brand-muted">TOTAL NET</div>
            <div className="font-semibold text-brand-dark">{formatCurrency(totals.amount_net)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-muted">TOTAL VAT</div>
            <div className="font-semibold text-brand-dark">{formatCurrency(totals.vat_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-muted">TOTAL WHT</div>
            <div className="font-semibold text-brand-dark">{formatCurrency(totals.wht_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-muted">GRAND TOTAL PAYABLE</div>
            <div className="text-lg font-bold text-brand-dark">{formatCurrency(totals.total)}</div>
          </div>
        </div>
      </div>

      {/* ===================== Payment Details ===================== */}
      {!expenseConfig?.hidePaymentSection && (
        <div className="mm-card">
          <h2 className="mm-section-label !mb-1 !border-b-0 !pb-0">Payment Details</h2>
          <p className="mb-3 text-xs text-brand-subtle">
            {procurementFillsPayment
              ? "Procurement will fill these in later"
              : "Required unless Procurement is filling these in"}
          </p>

          <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md border border-brand-border bg-[#F9F8F6] p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-brand-brown"
              checked={procurementFillsPayment}
              onChange={(e) => setProcurementFillsPayment(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-brand-dark">
                Let Procurement fill payment details
              </span>
              <span className="block text-xs text-brand-subtle">
                Tick this if you don&apos;t have payment info yet — Procurement will complete it
              </span>
            </span>
          </label>

          {procurementFillsPayment && (
            <div
              className="mb-3 rounded-md p-2.5 text-sm font-medium"
              style={{ background: "#DBEAFE", border: "1px solid #93C5FD", color: "#1E3A8A" }}
            >
              ℹ️ Procurement จะกรอกข้อมูลการชำระเงินให้ภายหลัง
            </div>
          )}

          <div className={`grid grid-cols-2 gap-4 ${procurementFillsPayment ? "opacity-60" : ""}`}>
            <div className="relative">
              <label className={labelClass}>
                Supplier/Payee{!procurementFillsPayment && <RequiredMark />}
              </label>
              <input
                className={inputClass}
                placeholder={
                  procurementFillsPayment ? "Procurement will fill" : "Type to search or enter a new supplier"
                }
                autoComplete="off"
                value={supplierName}
                onChange={(e) => {
                  setSupplierName(e.target.value);
                  setSupplierOpen(true);
                }}
                onFocus={() => setSupplierOpen(true)}
                onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
              />
              {supplierOpen && filteredSuppliers.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-brand-border bg-white shadow-lg">
                  {filteredSuppliers.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          handleSupplierChange(s.name);
                          setSupplierOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-[#F9F8F6]"
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className={labelClass}>
                Payment Method{!procurementFillsPayment && <RequiredMark />}
              </label>
              <select className={inputClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="">{procurementFillsPayment ? "Procurement will fill" : "-"}</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {!expenseConfig?.hideBankFields && showBankName && (
              <div>
                <label className={labelClass}>
                  Bank Name{!procurementFillsPayment && <RequiredMark />}
                </label>
                <select className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)}>
                  <option value="">{procurementFillsPayment ? "Procurement will fill" : "-"}</option>
                  {BANK_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}
            {!expenseConfig?.hideBankFields && showCardType && (
              <div>
                <label className={labelClass}>Card Type</label>
                <select className={inputClass} value={cardType} onChange={(e) => setCardType(e.target.value)}>
                  <option value="">-</option>
                  {CARD_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            {!expenseConfig?.hideBankFields && (
              <div>
                <label className={labelClass}>
                  Account No / Card No{!procurementFillsPayment && <RequiredMark />}
                </label>
                <input
                  className={inputClass}
                  placeholder={procurementFillsPayment ? "Procurement will fill" : undefined}
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                />
              </div>
            )}
            {expenseConfig?.showCreditTerm && (
              <div>
                <label className={labelClass}>Credit Term (days)</label>
                <input
                  type="number"
                  className={inputClass}
                  value={creditTermDays}
                  onChange={(e) =>
                    setCreditTermDays(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              </div>
            )}
            {!expenseConfig?.hideDueDate && (
              <div>
                <label className={labelClass}>
                  Due Date{!procurementFillsPayment && <RequiredMark />}
                </label>
                <input
                  type="date"
                  className={inputClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required={!procurementFillsPayment}
                />
              </div>
            )}

            <div className="col-span-2">
              <label className={labelClass}>Slip Payment Receiver</label>
              <select
                className={inputClass}
                value={slipReceiverEmail}
                onChange={(e) => setSlipReceiverEmail(e.target.value)}
              >
                {currentUser && !distinctReceiverEmails.includes(currentUser.email) && (
                  <option value={currentUser.email}>{currentUser.name} ({currentUser.email})</option>
                )}
                {slipReceiverEmail && !distinctReceiverEmails.includes(slipReceiverEmail) && (!currentUser || currentUser.email !== slipReceiverEmail) && (
                  <option value={slipReceiverEmail}>{slipReceiverEmail}</option>
                )}
                {distinctReceiverEmails.map((email) => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ===================== Attachments ===================== */}
      <div className="mm-card">
        <h2 className="mm-section-label">Attachments</h2>

        {expenseConfig?.requiredDocs && (
          <div className="mb-3 rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm">
            <p className="mb-1 font-medium text-brand-dark">
              Required documents{expenseConfig.requiredDocs.mode === "any" ? " (at least one)" : ""}
            </p>
            <ul className="space-y-0.5">
              {expenseConfig.requiredDocs.docs.map((docLabel) => {
                const satisfied = isDocTypeAttached(docLabel);
                return (
                  <li key={docLabel} className={satisfied ? "text-green-700" : "text-brand-muted"}>
                    {satisfied ? "✓" : "○"} {docLabel}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {isTravel && (() => {
          const travelByValues = Array.from(
            new Set(items.map((it) => it.travel_by).filter((t): t is string => !!t)),
          );
          if (travelByValues.length === 0) return null;
          return (
            <div className="mb-3 rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm">
              <p className="mb-1 font-medium text-brand-dark">Travel documents (per item, by Travel by)</p>
              <ul className="space-y-0.5">
                {travelByValues.flatMap((travelBy) =>
                  (TRAVEL_REQUIRED_DOCS[travelBy as keyof typeof TRAVEL_REQUIRED_DOCS] ?? []).map((docLabel) => {
                    const satisfied = isDocTypeAttached(docLabel);
                    return (
                      <li key={`${travelBy}-${docLabel}`} className={satisfied ? "text-green-700" : "text-brand-muted"}>
                        {satisfied ? "✓" : "○"} {docLabel} <span className="text-brand-subtle">({travelBy})</span>
                      </li>
                    );
                  }),
                )}
              </ul>
            </div>
          );
        })()}

        {expenseConfig?.showCreditTerm && (
          <div
            className="mb-3 rounded-md p-2.5 text-sm font-medium"
            style={{ background: "#FFF3CD", border: "1px solid #FFC107", color: "#856404" }}
          >
            {creditDeadlineMessage()}
          </div>
        )}

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
          }}
          className="flex h-11 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-brand-border text-sm text-brand-muted hover:bg-[#F9F8F6]"
        >
          📎 Click to attach files or drag &amp; drop — PDF, JPG, PNG, Word, Excel
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

        <div className="mt-3">
          <label className={labelClass}>Drive Folder URL (optional)</label>
          <input
            className={inputClass}
            placeholder="https://drive.google.com/drive/folders/..."
            value={filesFolderUrl}
            onChange={(e) => setFilesFolderUrl(e.target.value)}
          />
        </div>

        {uploadStatus && (
          <p className="mt-3 text-sm text-brand-muted">⏳ {uploadStatus}</p>
        )}
        {attachmentError && (
          <p className="mt-3 text-sm text-red-600">{attachmentError}</p>
        )}

        <div className="mt-3 space-y-2">
          {files.map((file, idx) => (
            <div key={idx} className="flex items-center gap-2 rounded-md border border-brand-border px-3 py-2 text-sm">
              <select
                className={`${cellClass} w-56`}
                value={file.doc_type ?? ""}
                onChange={(e) => updateFile(idx, { doc_type: e.target.value })}
              >
                <option value="">Document type...</option>
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (file.path) {
                    e.preventDefault();
                    openStoredFile(file);
                  }
                }}
                className="flex-1 truncate text-brand-brown hover:underline"
              >
                {file.name}
              </a>
              <span className="text-xs text-brand-muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="font-medium text-[#DC2626] hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          {pendingFiles.map((pending, idx) => (
            <div
              key={`pending-${idx}`}
              className="flex items-center gap-2 rounded-md border border-dashed border-brand-border px-3 py-2 text-sm"
            >
              <select
                className={`${cellClass} w-56`}
                value={pending.docType}
                onChange={(e) => updatePendingFile(idx, e.target.value)}
              >
                <option value="">Document type...</option>
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>
              <span className="flex-1 truncate text-brand-dark">{pending.file.name}</span>
              <span className="text-xs text-brand-subtle">{formatBytes(pending.file.size)} · will upload on submit</span>
              <button
                type="button"
                onClick={() => removePendingFile(idx)}
                className="font-medium text-[#DC2626] hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {pendingFiles.length > 0 && enableDrafts && (
          // Drafts persist buildPayload()'s JSON only — a raw File object
          // can't round-trip through that, so files picked but not yet
          // submitted are lost if this form is left as a draft rather than
          // submitted (a real gap vs. the old base64-everywhere behavior,
          // where a picked file became part of files_json, and therefore
          // the draft, immediately on pick).
          <p className="mt-2 text-xs text-brand-subtle">
            Note: files above haven&apos;t been uploaded yet — saving this as a draft won&apos;t keep them; submit the
            request to upload them.
          </p>
        )}
      </div>

      <p className="text-xs text-brand-subtle">
        Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || secondaryBusy}
          className="mm-btn-primary h-11 flex-1 text-[15px]"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={handleSecondary}
            disabled={submitting || secondaryBusy}
            className="mm-btn-secondary h-11 flex-1 border-brand-brown text-[15px] text-brand-brown hover:bg-[#F9F8F6]"
          >
            {secondaryBusy ? secondaryAction.busyLabel : secondaryAction.label}
          </button>
        )}
      </div>
    </form>
  );
}
