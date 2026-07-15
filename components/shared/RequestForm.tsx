"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RequiredMark from "@/components/shared/RequiredMark";
import {
  BANK_OPTIONS,
  BUSINESS_UNITS,
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

const MAX_FILE_BYTES = 5 * 1024 * 1024;

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

function fileToEntry(file: File): Promise<FileEntry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, url: reader.result as string, size: file.size, doc_type: "" });
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
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
  onSubmit: (payload: RequestFormPayload) => Promise<void>;
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

  // Business Unit lock: a user whose every roles row shares one specific
  // bu_scope value (never "*") gets that value locked read-only; anyone
  // with an unrestricted ("*") row, or rows disagreeing on the value, still
  // gets the free SV/ONEST choice.
  const resolvedBuScope = useMemo((): { locked: boolean; value: string | null } => {
    const scopes = currentUser?.allRoles?.map((r) => r.bu_scope) ?? [];
    if (scopes.length === 0 || scopes.some((s) => s === "*")) return { locked: false, value: null };
    const distinct = Array.from(
      new Set(scopes.flatMap((s) => s.split(",").map((x) => x.trim()).filter(Boolean))),
    );
    return distinct.length === 1 ? { locked: true, value: distinct[0] } : { locked: false, value: null };
  }, [currentUser]);

  useEffect(() => {
    if (initial?.bu) return; // edit mode already has a concrete value
    if (resolvedBuScope.locked && resolvedBuScope.value) setBu(resolvedBuScope.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedBuScope]);

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

  // --- Attachments ---------------------------------------------------------
  const [filesFolderUrl, setFilesFolderUrl] = useState(initial?.filesFolderUrl ?? "");
  const [files, setFiles] = useState<FileEntry[]>(initial?.files ?? []);
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
    const entries: FileEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        alert(`${file.name} is larger than 5MB and can't be attached (no Google Drive integration is configured in this environment, so files fall back to inline storage with a 5MB cap).`);
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
    // Due Date is marked required (see its label) only where it's actually
    // shown — Payment Details section visible and not hidden for this
    // expense type.
    if (!expenseConfig?.hidePaymentSection && !expenseConfig?.hideDueDate && !dueDate) {
      return "Due Date is required";
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
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(buildPayload());
      // A submitted request is no longer a draft — clean up the row it was
      // loaded from, if any.
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE" }).catch(() => {});
        onDraftDeleted?.();
      }
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
            <label className={labelClass}>Business Unit<RequiredMark /></label>
            {resolvedBuScope.locked ? (
              <input className={`${inputClass} bg-[#F9F8F6]`} value={bu} disabled readOnly />
            ) : (
              <select className={inputClass} value={bu} onChange={(e) => setBu(e.target.value)}>
                {BUSINESS_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            )}
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
          <label className={labelClass}>Use for company<RequiredMark /></label>
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
          <p className="mt-1 text-xs text-brand-subtle">Which company is this expense for</p>
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
              onChange={(e) => setPettyCashHolderEmail(e.target.value)}
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
          <p className="mb-3 text-xs text-brand-subtle">optional — Procurement can fill later</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className={labelClass}>Supplier/Payee</label>
              <input
                className={inputClass}
                placeholder="Type to search or enter a new supplier"
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
              <label className={labelClass}>Payment Method</label>
              <select className={inputClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="">-</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {!expenseConfig?.hideBankFields && showBankName && (
              <div>
                <label className={labelClass}>Bank Name</label>
                <select className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)}>
                  <option value="">-</option>
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
                <label className={labelClass}>Account No / Card No</label>
                <input className={inputClass} value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
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
                <label className={labelClass}>Due Date<RequiredMark /></label>
                <input
                  type="date"
                  className={inputClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
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
                    const satisfied = files.some((f) => f.doc_type === docLabel);
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
              <span className="flex-1 truncate text-brand-dark">{file.name}</span>
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
        </div>
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
