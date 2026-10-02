"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import RequiredMark from "@/components/shared/RequiredMark";
import UsersAccessTab from "@/components/settings/UsersAccessTab";
import { BANK_OPTIONS, BUSINESS_UNITS, DEPARTMENTS, PAYMENT_METHODS, type Role } from "@/lib/constants";
import {
  canAccessSettingsTab,
  firstAccessibleSettingsTab,
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB_ROLES,
  type SettingsTab,
  type ManagedSettingsTab,
} from "@/lib/permissions";
import type {
  AnnouncementRow,
  CategoryRow,
  CompanyRow,
  CurrentUser,
  DeptConfigRow,
  PettyCashCustodianRow,
  ProductRow,
  SupplierRow,
} from "@/types/database";

type Tab = SettingsTab;

const TAB_LABELS: Record<Tab, string> = {
  suppliers: "Supplier Management",
  products: "Product/SKU Management",
  categories: "Category L1/L2 Management",
  deptconfig: "CEO Signature Rules",
  announcements: "Announcements",
  pettycash: "Petty Cash Custodians",
  companies: "Companies",
  usersaccess: "Users & access",
};

// Order/membership comes from lib/permissions.ts#SETTINGS_TABS — the same
// list the server-side permission checks are built from — rather than a
// second, independently-maintained array here.
const TABS: { key: Tab; label: string }[] = SETTINGS_TABS.map((key) => ({ key, label: TAB_LABELS[key] }));

// "Pending" per spec: is_auto_registered (an admin hasn't touched this row
// yet — PATCH /api/roles/[id] unconditionally clears this on any save, so
// it's the actual "needs admin attention" signal, not r.role), created
// within the last 7 days, and this is the user's *only* roles row (i.e.
// nobody has added a second role for them, which would mean someone
// already looked at their access). Shared by the tab badge count (a
// lightweight roles fetch in SettingsClient below) and the Pending Users
// section inside UserTab (which already loads the full roles list for its
// own table).


const inputClass = "mm-input";
const labelClass = "mb-1.5 block text-[13px] font-medium text-[#374151]";
const buttonPrimary = "mm-btn-primary mm-btn-sm";
const buttonSecondary = "mm-btn-secondary mm-btn-sm";

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="mm-modal-overlay items-center">
      <div className={`mm-modal ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="mm-modal-header">
          <h3 className="mm-modal-title">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-brand-muted transition-colors hover:bg-[#F5F0E8] hover:text-brand-dark"
          >
            ✕
          </button>
        </div>
        <div className="mm-modal-body">{children}</div>
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router — the
// actual logic lives in SettingsClientInner below.
export default function SettingsClient() {
  return (
    <Suspense fallback={<p className="text-sm text-brand-muted">Loading...</p>}>
      <SettingsClientInner />
    </Suspense>
  );
}

function SettingsClientInner() {
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [tab, setTabState] = useState<Tab | null>(null);
  // DB-backed settings_tab_permissions config, replacing the old hardcoded
  // SETTINGS_TAB_ROLES — null while still loading, in which case every
  // canAccessSettingsTab/firstAccessibleSettingsTab call below falls back
  // to DEFAULT_SETTINGS_TAB_ROLES (its own default parameter), which is
  // byte-for-byte the same as today's seeded DB values, so there's no
  // visible flash of wrong tabs while this is in flight.
  const [tabConfig, setTabConfig] = useState<Record<ManagedSettingsTab, Role[]> | null>(null);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user as CurrentUser);
      })
      .finally(() => setUserLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/settings-permissions")
      .then((res) => res.json())
      .then((data) => setTabConfig(data.permissions ?? null))
      .catch(() => {});
  }, []);

  const effectiveTabConfig = tabConfig ?? DEFAULT_SETTINGS_TAB_ROLES;

  const visibleTabs = useMemo(
    () => (currentUser ? TABS.filter((t) => canAccessSettingsTab(currentUser, t.key, effectiveTabConfig)) : []),
    [currentUser, effectiveTabConfig],
  );

  // Resolve the active tab once we know who's asking: honor ?tab= from the
  // URL if it's a real tab this user can access; otherwise fall back to
  // (and rewrite the URL to) their first accessible tab. Uses the History
  // API directly rather than router.push/replace — a Next.js navigation
  // here would re-run the server-side page.tsx guard on every tab switch
  // for no benefit, when all this needs is the address bar to reflect the
  // current tab for bookmarking/sharing/back-button.
  useEffect(() => {
    if (!currentUser) return;
    const requested = searchParams.get("tab") as Tab | null;
    const requestedIsValid = !!requested && canAccessSettingsTab(currentUser, requested, effectiveTabConfig);
    const resolved = requestedIsValid ? (requested as Tab) : firstAccessibleSettingsTab(currentUser, effectiveTabConfig);
    setTabState(resolved);
    if (resolved && resolved !== requested) {
      window.history.replaceState(null, "", `/settings?tab=${resolved}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, effectiveTabConfig]);

  const selectTab = (key: Tab) => {
    setTabState(key);
    window.history.replaceState(null, "", `/settings?tab=${key}`);
  };

  if (userLoading) {
    return <p className="text-sm text-brand-muted">Loading...</p>;
  }

  if (!currentUser || visibleTabs.length === 0) {
    return (
      <div>
        <h1 className="mm-page-title mb-4">Settings</h1>
        <p className="text-sm text-brand-muted">
          You don&apos;t have access to any Settings section. Contact an admin if you need access.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mm-page-title mb-4">Settings</h1>
      <div className="mm-tabs mb-4">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`mm-tab ${tab === t.key ? "mm-tab-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "suppliers" && <SupplierTab />}
      {tab === "products" && <ProductTab />}
      {tab === "categories" && <CategoryTab />}
      {tab === "deptconfig" && <DeptConfigTab />}
      {tab === "announcements" && <AnnouncementTab />}
      {tab === "pettycash" && <PettyCashCustodianTab />}
      {tab === "companies" && <CompanyTab />}
      {tab === "usersaccess" && <UsersAccessTab />}
    </div>
  );
}

// --- Tab 1: Supplier Management --------------------------------------------

const emptySupplierForm = () => ({
  name: "",
  payment_method: "",
  bank_name: "",
  account_no: "",
  email: "",
  notes: "",
});

function SupplierTab() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: number } | null>(null);
  const [form, setForm] = useState(emptySupplierForm());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(emptySupplierForm());
    setModal({ mode: "add" });
  };

  const openEdit = (s: SupplierRow) => {
    setForm({
      name: s.name,
      payment_method: s.payment_method ?? "",
      bank_name: s.bank_name ?? "",
      account_no: s.account_no ?? "",
      email: s.email ?? "",
      notes: s.notes ?? "",
    });
    setModal({ mode: "edit", id: s.id });
  };

  const save = async () => {
    if (!form.name.trim()) {
      alert("Supplier Name is required");
      return;
    }
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/suppliers/${modal.id}` : "/api/suppliers";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save supplier");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this supplier?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete supplier");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete supplier");
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = suppliers.map((s) => ({
      Name: s.name,
      "Payment Method": s.payment_method ?? "",
      "Bank Name": s.bank_name ?? "",
      "Account No": s.account_no ?? "",
      Email: s.email ?? "",
      Notes: s.notes ?? "",
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Suppliers");
    XLSX.writeFile(workbook, "suppliers.xlsx");
  };

  return (
    <div>
      <div className="mb-3 flex justify-between">
        <button onClick={exportExcel} disabled={suppliers.length === 0} className={buttonSecondary}>
          Export to Excel
        </button>
        <button onClick={openAdd} className={buttonPrimary}>
          + Add New Supplier
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : suppliers.length === 0 ? (
        <p className="text-sm text-brand-muted">No suppliers yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Payment Method</th>
                <th className="px-3 py-2">Bank Name</th>
                <th className="px-3 py-2">Account No</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">{s.payment_method ?? "-"}</td>
                  <td className="px-3 py-2">{s.bank_name ?? "-"}</td>
                  <td className="px-3 py-2">{s.account_no ?? "-"}</td>
                  <td className="px-3 py-2">{s.email ?? "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(s)} className="mr-3 text-brand-brown hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="font-medium text-[#DC2626] hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add New Supplier" : "Edit Supplier"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Supplier Name<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Payment Method</label>
              <select
                className={`${inputClass} w-full`}
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
              >
                <option value="">-</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Bank Name</label>
              <select
                className={`${inputClass} w-full`}
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              >
                <option value="">-</option>
                {BANK_OPTIONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Account No / Card No</label>
              <input
                className={`${inputClass} w-full`}
                value={form.account_no}
                onChange={(e) => setForm({ ...form, account_no: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className={`${inputClass} w-full`}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <textarea
                className={`${inputClass} w-full`}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 2: Product/SKU Management --------------------------------------------

/**
 * Segments a PRODUCT can belong to — every department except Retail.
 *
 * A Retail "product" is a BRANCH, and branches are revenue_channels. Since
 * /submit started reading its Retail branch list from the channels, a Retail
 * row created here feeds nothing: it would sit in the table looking like a
 * configured branch and never appear in any picker.
 *
 * The EXISTING seven Retail rows are deliberately NOT removed. Song Wat and
 * Talat Noi are named on 138 and 98 requests; the rows are the only record
 * that those values were ever a managed list rather than free text. This stops
 * new ones being made, it does not rewrite history.
 */
const PRODUCT_SEGMENTS = DEPARTMENTS.filter((d) => d !== "Retail");

const emptyProductForm = () => ({
  sku_code: "",
  product_name: "",
  department: "",
  bu: "",
});

function ProductTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: number } | null>(null);
  const [form, setForm] = useState(emptyProductForm());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(emptyProductForm());
    setModal({ mode: "add" });
  };

  const openEdit = (p: ProductRow) => {
    setForm({
      sku_code: p.sku_code ?? "",
      product_name: p.product_name,
      department: p.department ?? "",
      bu: p.bu ?? "",
    });
    setModal({ mode: "edit", id: p.id });
  };

  const save = async () => {
    if (!form.product_name.trim()) {
      alert("Product Name is required");
      return;
    }
    if (!form.department) {
      alert("Segment is required");
      return;
    }
    if (!form.bu) {
      alert("BU is required");
      return;
    }
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/products/${modal.id}` : "/api/products";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save product");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this product?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete product");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete product");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={openAdd} className={buttonPrimary}>
          + Add New Product
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-brand-muted">No products yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">SKU Code</th>
                <th className="px-3 py-2">Product Name</th>
                <th className="px-3 py-2">Segment</th>
                <th className="px-3 py-2">BU</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 tabular-nums text-xs">{p.sku_code ?? "-"}</td>
                  <td className="px-3 py-2">{p.product_name}</td>
                  <td className="px-3 py-2">{p.department ?? "-"}</td>
                  <td className="px-3 py-2">{p.bu ?? "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(p)} className="mr-3 text-brand-brown hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="font-medium text-[#DC2626] hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add New Product" : "Edit Product"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>SKU Code</label>
              <input
                className={`${inputClass} w-full`}
                value={form.sku_code}
                onChange={(e) => setForm({ ...form, sku_code: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Product Name<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.product_name}
                onChange={(e) => setForm({ ...form, product_name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Segment<RequiredMark /></label>
              <select
                className={`${inputClass} w-full`}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              >
                <option value="">-</option>
                {PRODUCT_SEGMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-brand-subtle">
                Retail is not listed: a Retail branch is a <strong>revenue channel</strong>, added
                on the Budget page. Creating one here would do nothing — Submit reads branches from
                the channel list.
              </p>
            </div>
            <div>
              <label className={labelClass}>BU<RequiredMark /></label>
              <select
                className={`${inputClass} w-full`}
                value={form.bu}
                onChange={(e) => setForm({ ...form, bu: e.target.value })}
              >
                <option value="">-</option>
                {BUSINESS_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 4: Category L1/L2 Management --------------------------------------------

const emptyCategoryForm = () => ({
  bu: BUSINESS_UNITS[0] as string,
  department: DEPARTMENTS[0] as string,
  cat_l1: "",
  cat_l2: "",
  product: "",
});

interface RawImportRow {
  [key: string]: unknown;
}

interface ParsedCategoryRow {
  bu: string;
  department: string;
  cat_l1: string;
  cat_l2: string;
  product: string;
}

function normalizeImportRow(raw: RawImportRow): ParsedCategoryRow {
  const get = (keys: string[]) => {
    for (const key of Object.keys(raw)) {
      const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, "_");
      if (keys.includes(normalizedKey)) {
        const val = raw[key];
        return val == null ? "" : String(val).trim();
      }
    }
    return "";
  };
  return {
    bu: get(["bu"]),
    department: get(["department", "dept"]),
    cat_l1: get(["cat_l1", "catl1", "category_l1"]),
    cat_l2: get(["cat_l2", "catl2", "category_l2"]),
    product: get(["product"]),
  };
}

// Simple comma-split parser for the fixed 5-column format this import
// expects (bu, department, cat_l1, cat_l2, product) — no quoted-field
// escaping. Strips a UTF-8 BOM if present (common in Excel-exported CSVs).
function parseCsv(text: string): RawImportRow[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: RawImportRow = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

function BulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedCategoryRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; invalid: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setImportError(null);
    setParsedRows([]);
    setParseError(null);

    const text = await file.text(); // decodes as UTF-8
    const raw = parseCsv(text);
    if (raw.length === 0) {
      setParseError(
        "No data rows found — expected a header row (bu, department, cat_l1, cat_l2, product) followed by at least one data row.",
      );
      return;
    }
    const normalized = raw.map(normalizeImportRow);
    const missingRequired = normalized.filter((r) => !r.bu || !r.department).length;
    if (missingRequired === normalized.length) {
      setParseError(
        "Couldn't find bu/department columns in the header row — check the CSV has columns named bu, department, cat_l1, cat_l2, product.",
      );
      return;
    }
    setParsedRows(normalized);
  };

  const confirmImport = async () => {
    setBusy(true);
    setImportError(null);
    setResult(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulk: true, rows: parsedRows }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Import failed");
      setResult({ inserted: body.inserted ?? 0, skipped: body.skipped ?? 0, invalid: body.invalid ?? 0 });
      setParsedRows([]);
      onImported();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const invalidCount = parsedRows.filter((r) => !r.bu || !r.department).length;

  return (
    <Modal title="Bulk Import Categories" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Upload .csv (columns: bu, department, cat_l1, cat_l2, product)</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
            className="text-sm"
          />
          {fileName && <p className="mt-1 text-xs text-brand-muted">Selected: {fileName}</p>}
          {parseError && <p className="mt-1 text-sm text-red-600">{parseError}</p>}
        </div>

        {parsedRows.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-brand-dark">
              Preview — {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"}
              {invalidCount > 0 ? ` (${invalidCount} missing bu/department will be skipped)` : ""}
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-brand-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#F9F8F6] text-left text-brand-dark">
                  <tr>
                    <th className="px-2 py-1.5">bu</th>
                    <th className="px-2 py-1.5">department</th>
                    <th className="px-2 py-1.5">cat_l1</th>
                    <th className="px-2 py-1.5">cat_l2</th>
                    <th className="px-2 py-1.5">product</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-t border-brand-border ${!r.bu || !r.department ? "bg-red-50 text-red-700" : ""}`}
                    >
                      <td className="px-2 py-1.5">{r.bu || "-"}</td>
                      <td className="px-2 py-1.5">{r.department || "-"}</td>
                      <td className="px-2 py-1.5">{r.cat_l1 || "-"}</td>
                      <td className="px-2 py-1.5">{r.cat_l2 || "-"}</td>
                      <td className="px-2 py-1.5">{r.product || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={confirmImport} disabled={busy} className={buttonPrimary}>
                {busy ? "Importing..." : `Confirm Import (${parsedRows.length} rows)`}
              </button>
            </div>
          </div>
        )}

        {result && (
          <p className="text-sm text-green-700">
            {result.inserted} inserted, {result.skipped} skipped (already existed)
            {result.invalid > 0 ? `, ${result.invalid} skipped (missing bu or department)` : ""}.
          </p>
        )}
        {importError && <p className="text-sm text-red-600">{importError}</p>}

        <div className="flex justify-end">
          <button onClick={onClose} className={buttonSecondary}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CategoryTab() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState(emptyCategoryForm());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // Collapsed keys, so the default is OPEN for anything newly appearing and a
  // fresh group is never hidden. Same shape the budget grid uses.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const CAT_COLLAPSE_KEY = "mm:settings:categories:collapsed";

  // Null until the key has been read. "Nothing stored" and "stored but empty"
  // are different: the first means collapse everything, the second means
  // someone deliberately expanded it all. An empty array cannot tell them
  // apart, so PRESENCE of the key is what is tested — same reasoning as the
  // budget grid.
  const needsDefault = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CAT_COLLAPSE_KEY);
      if (raw === null) needsDefault.current = true;
      else setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch { needsDefault.current = true; }
  }, []);

  const load = () => {
    setLoading(true);
    // includeInactive: Settings manages retired categories, so it must see
    // them. Every other consumer gets active-only by default.
    fetch("/api/categories?includeInactive=1")
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(emptyCategoryForm());
    setModal({ mode: "add" });
  };

  const openEdit = (c: CategoryRow) => {
    setForm({
      bu: c.bu,
      department: c.department,
      cat_l1: c.cat_l1 ?? "",
      cat_l2: c.cat_l2 ?? "",
      product: c.product ?? "",
    });
    setModal({ mode: "edit", id: c.id });
  };

  // company -> department -> cat_l1 -> rows. Built from the API's already
  // deterministic order, so the tree is stable between loads.
  const tree = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (c: CategoryRow) =>
      !needle ||
      [c.bu, c.department, c.cat_l1, c.cat_l2, c.product]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    const out: { bu: string; depts: { dept: string; l1s: { l1: string; rows: CategoryRow[] }[] }[] }[] = [];
    for (const c of categories.filter(match)) {
      const bu = String(c.bu), dept = String(c.department), l1 = String(c.cat_l1 ?? "—");
      let b = out.find((x) => x.bu === bu);
      if (!b) { b = { bu, depts: [] }; out.push(b); }
      let d = b.depts.find((x) => x.dept === dept);
      if (!d) { d = { dept, l1s: [] }; b.depts.push(d); }
      let g = d.l1s.find((x) => x.l1 === l1);
      if (!g) { g = { l1, rows: [] }; d.l1s.push(g); }
      g.rows.push(c);
    }
    return out;
  }, [categories, q]);

  // Collapsed by default, applied once, and only after the rows exist — the
  // groups are not known before then. A remembered state always wins.
  useEffect(() => {
    if (!needsDefault.current || categories.length === 0) return;
    needsDefault.current = false;
    const all = new Set<string>();
    for (const c of categories) {
      const bu = String(c.bu), dept = String(c.department), l1 = String(c.cat_l1 ?? "—");
      all.add(`b:${bu}`); all.add(`d:${bu}|${dept}`); all.add(`l:${bu}|${dept}|${l1}`);
    }
    setCollapsed(all);
  }, [categories]);

  const matchCount = useMemo(
    () => tree.reduce((n, b) => n + b.depts.reduce((m, d) => m + d.l1s.reduce((k, g) => k + g.rows.length, 0), 0), 0),
    [tree],
  );

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { window.localStorage.setItem(CAT_COLLAPSE_KEY, JSON.stringify(Array.from(next))); } catch { /* private mode */ }
      return next;
    });

  const setAll = (collapse: boolean) => {
    const next = new Set<string>();
    if (collapse) for (const b of tree) {
      next.add(`b:${b.bu}`);
      for (const d of b.depts) { next.add(`d:${b.bu}|${d.dept}`);
        for (const g of d.l1s) next.add(`l:${b.bu}|${d.dept}|${g.l1}`); }
    }
    setCollapsed(next);
    try { window.localStorage.setItem(CAT_COLLAPSE_KEY, JSON.stringify(Array.from(next))); } catch { /* private mode */ }
  };

  const describe = (d: { budget_lines: number; request_headers: number; request_items: number }) =>
    `${d.budget_lines} budget line(s), ${d.request_headers} request(s) and ${d.request_items} request item(s)`;

  const save = async () => {
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/categories/${modal.id}` : "/api/categories";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const send = (extra: Record<string, unknown> = {}) =>
        fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, ...extra }),
        });

      let res = await send();
      // 409 confirmation_required: the server counted the dependants and is
      // refusing until they have been shown. It is the server that decides
      // this, so a client that skipped the dialog still cannot rename blind.
      if (res.status === 409) {
        const body = await res.json();
        if (body.error === "confirmation_required") {
          const d = body.dependencies;
          const total = d.budget_lines + d.request_headers + d.request_items;
          const cascade = confirm(
            `${body.message}\n\n` +
            `${describe(d)} reference it by name.\n\n` +
            `OK — rename those ${total} row(s) too, in the same transaction.\n` +
            `Cancel — rename the category only, leaving ${total} row(s) pointing at the old name ` +
            `(this is recorded in the audit log).`,
          );
          res = await send({ confirmed: true, cascade });
        }
      }
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Failed to save category");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save category");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (id: string, active: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      // Ask the server what depends on it BEFORE offering the confirmation,
      // so the number in the dialog is the real one rather than a guess.
      const info = await (await fetch(`/api/categories/${id}`)).json();
      const d = info?.dependencies?.catL2;
      const total = d ? d.budget_lines + d.request_headers + d.request_items : 0;
      if (total > 0) {
        alert(
          `Cannot delete this category — ${describe(d)} reference it by name, ` +
          `and there is no key to reattach them by once the name is gone.\n\n` +
          `Deactivate it instead: it disappears from the submit form and from new ` +
          `budgets, and its history stays intact and still shows in the spend report.`,
        );
        setBusy(false);
        return;
      }
      if (!confirm("Delete this category row? Nothing references it, so nothing is orphaned.")) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? body.error ?? "Failed to delete category");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} w-[280px]`}
          placeholder="Search company, segment, category, product"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-[12px] text-brand-muted">
          {matchCount} of {categories.length} rows
        </span>
        <button onClick={() => setAll(true)} className={`${buttonSecondary} ml-auto`}>Collapse all</button>
        <button onClick={() => setAll(false)} className={buttonSecondary}>Expand all</button>
        <button onClick={() => setBulkOpen(true)} className={buttonSecondary}>Bulk Import</button>
        <button onClick={openAdd} className={buttonPrimary}>+ Add New Category</button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-brand-muted">No categories yet.</p>
      ) : matchCount === 0 ? (
        <p className="text-sm text-brand-muted">Nothing matches “{q}”.</p>
      ) : (
        /* GROUPED: company > department > cat_l1 > sub-categories. It was a
           flat list of every row in storage order, so one cat_l1 appeared at
           scattered positions and read as duplication — each row is in fact a
           distinct (company, department, cat_l1, cat_l2). */
        <div className="mm-table-wrap divide-y divide-brand-border">
          {tree.map((b) => {
            const bKey = `b:${b.bu}`;
            const bOpen = !collapsed.has(bKey);
            const bRows = b.depts.reduce((n, d) => n + d.l1s.reduce((m, g) => m + g.rows.length, 0), 0);
            return (
              <div key={bKey}>
                <button
                  type="button"
                  onClick={() => toggle(bKey)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-[0.04em] text-brand-dark"
                  style={{ background: "#F5F2EC" }}
                >
                  <span className="w-3 text-[10px] text-brand-muted">{bOpen ? "▾" : "▸"}</span>
                  {b.bu}
                  <span className="text-[10.5px] font-normal normal-case tracking-normal text-brand-muted">
                    {b.depts.length} segment{b.depts.length === 1 ? "" : "s"} · {bRows} row{bRows === 1 ? "" : "s"}
                  </span>
                </button>

                {bOpen && b.depts.map((d) => {
                  const dKey = `d:${b.bu}|${d.dept}`;
                  const dOpen = !collapsed.has(dKey);
                  const dRows = d.l1s.reduce((m, g) => m + g.rows.length, 0);
                  return (
                    <div key={dKey}>
                      <button
                        type="button"
                        onClick={() => toggle(dKey)}
                        className="flex w-full items-center gap-2 py-1.5 pl-6 pr-3 text-left text-[12.5px] font-medium text-brand-dark"
                        style={{ background: "#FCFBF9" }}
                      >
                        <span className="w-3 text-[10px] text-brand-muted">{dOpen ? "▾" : "▸"}</span>
                        {d.dept}
                        <span className="text-[10.5px] font-normal text-brand-muted">
                          {d.l1s.length} categor{d.l1s.length === 1 ? "y" : "ies"} · {dRows} row{dRows === 1 ? "" : "s"}
                        </span>
                      </button>

                      {dOpen && d.l1s.map((g) => {
                        const lKey = `l:${b.bu}|${d.dept}|${g.l1}`;
                        const lOpen = !collapsed.has(lKey);
                        return (
                          <div key={lKey}>
                            <button
                              type="button"
                              onClick={() => toggle(lKey)}
                              className="flex w-full items-center gap-2 py-1.5 pl-12 pr-3 text-left text-[12.5px] text-brand-dark"
                            >
                              <span className="w-3 text-[10px] text-brand-muted">{lOpen ? "▾" : "▸"}</span>
                              {g.l1}
                              <span className="text-[10.5px] text-brand-subtle">{g.rows.length}</span>
                            </button>

                            {lOpen && (
                              <table className="mm-table w-full">
                                <tbody>
                                  {g.rows.map((c) => {
                                    const retired = (c as { active?: boolean }).active === false;
                                    return (
                                      <tr key={c.id} style={retired ? { opacity: 0.55 } : undefined}>
                                        <td className="py-1.5 pl-20 pr-3 text-[13px]">
                                          {c.cat_l2?.trim() ? c.cat_l2 : <span className="text-brand-subtle">(no sub-category)</span>}
                                          {retired && (
                                            <span
                                              className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                              style={{ background: "#F3F4F6", color: "#6B7280", border: "1px solid #D8CBB0" }}
                                            >
                                              retired
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-[12px] text-brand-muted">{c.product ?? ""}</td>
                                        <td className="px-3 py-1.5 text-right">
                                          <button onClick={() => openEdit(c)} className="mr-3 text-brand-brown hover:underline">
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => void setActive(c.id, retired)}
                                            disabled={busy}
                                            className="mr-3 text-brand-muted hover:underline"
                                            title={retired
                                              ? "Offer this category again on the submit form and in new budgets"
                                              : "Stop offering it on the submit form, in the BO scope picker and in new budget drafts. History is untouched and still shows in the spend report."}
                                          >
                                            {retired ? "Reactivate" : "Deactivate"}
                                          </button>
                                          <button
                                            onClick={() => remove(c.id)}
                                            disabled={busy}
                                            className="font-medium text-[#DC2626] hover:underline"
                                            title="Only possible when nothing references this category"
                                          >
                                            Delete
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add New Category" : "Edit Category"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>BU<RequiredMark /></label>
                <select
                  className={`${inputClass} w-full`}
                  value={form.bu}
                  onChange={(e) => setForm({ ...form, bu: e.target.value })}
                >
                  {BUSINESS_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Segment<RequiredMark /></label>
                <select
                  className={`${inputClass} w-full`}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Cat L1</label>
              <input
                className={`${inputClass} w-full`}
                value={form.cat_l1}
                onChange={(e) => setForm({ ...form, cat_l1: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Cat L2</label>
              <input
                className={`${inputClass} w-full`}
                value={form.cat_l2}
                onChange={(e) => setForm({ ...form, cat_l2: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Product (optional)</label>
              <input
                className={`${inputClass} w-full`}
                value={form.product}
                onChange={(e) => setForm({ ...form, product: e.target.value })}
              />
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bulkOpen && (
        <BulkImportModal
          onClose={() => setBulkOpen(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

// --- Tab 5: CEO Signature Rules (dept_config) --------------------------------------------

const emptyDeptConfigForm = () => ({
  dept: DEPARTMENTS[0] as string,
  bu: "*",
  cat_l1: "*",
  bo_email: "",
  exceed_amount: 0,
  ceo_signature_required: false,
  skip_bo: false,
  skip_ceo: false,
});

function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex-1 rounded-md border-2 px-3 py-1.5 text-sm ${value ? "border-brand-brown bg-[#F0F4EF]" : "border-brand-border bg-white"}`}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex-1 rounded-md border-2 px-3 py-1.5 text-sm ${!value ? "border-brand-brown bg-[#F0F4EF]" : "border-brand-border bg-white"}`}
      >
        No
      </button>
    </div>
  );
}

function DeptConfigTab() {
  const [rows, setRows] = useState<DeptConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: string } | null>(null);
  const [form, setForm] = useState(emptyDeptConfigForm());
  const [busy, setBusy] = useState(false);

  // Reference data for the Segment/Cat L1 dropdowns in the Add/Edit Rule
  // modal — same /api/departments and /api/categories endpoints /submit and
  // the User Management tab use for their own pickers, so this tab reflects
  // whatever Settings > Category L1/L2 Management has configured instead of
  // a hardcoded list.
  const [segmentOptions, setSegmentOptions] = useState<string[]>([...DEPARTMENTS]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const load = () => {
    setLoading(true);
    fetch("/api/dept-config")
      .then((res) => res.json())
      .then((data) => setRows(data.dept_config ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setSegmentOptions(data.departments?.length ? data.departments : [...DEPARTMENTS]))
      .catch(() => setSegmentOptions([...DEPARTMENTS]));
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []));
  }, []);

  // Cat L1 options narrow to the currently selected Segment and BU (unless
  // either is "*") — same '*'-wildcard-or-exact-match convention used
  // throughout this schema. Recomputes automatically whenever Segment or BU
  // changes, so switching either refreshes the Cat L1 dropdown.
  const catL1Options = useMemo(() => {
    return Array.from(
      new Set(
        categories
          .filter(
            (c) =>
              (form.bu === "*" || c.bu === "*" || c.bu === form.bu) &&
              (form.dept === "*" || c.department === "*" || c.department === form.dept) &&
              c.cat_l1,
          )
          .map((c) => c.cat_l1 as string),
      ),
    ).sort();
  }, [categories, form.bu, form.dept]);

  // Defensive fallback so an already-stored value that no longer shows up
  // in the live options list (e.g. the Segment/Cat L1 was renamed or
  // removed since this rule was saved) still renders as selected rather
  // than silently blanking out when editing.
  const segmentSelectOptions =
    form.dept !== "*" && form.dept && !segmentOptions.includes(form.dept)
      ? [form.dept, ...segmentOptions]
      : segmentOptions;
  const catL1SelectOptions =
    form.cat_l1 !== "*" && form.cat_l1 && !catL1Options.includes(form.cat_l1)
      ? [form.cat_l1, ...catL1Options]
      : catL1Options;

  const openAdd = () => {
    setForm(emptyDeptConfigForm());
    setModal({ mode: "add" });
  };

  const openEdit = (r: DeptConfigRow) => {
    setForm({
      dept: r.dept,
      bu: r.bu,
      cat_l1: r.cat_l1,
      bo_email: r.bo_email ?? "",
      exceed_amount: r.exceed_amount,
      ceo_signature_required: r.ceo_signature_required,
      skip_bo: r.skip_bo,
      skip_ceo: r.skip_ceo,
    });
    setModal({ mode: "edit", id: r.id });
  };

  const save = async () => {
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/dept-config/${modal.id}` : "/api/dept-config";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save rule");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/dept-config/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete rule");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-3 text-xs text-brand-muted">
        Drives skip_bo/skip_ceo and CEO-signature requirements — matched score-based by
        Segment + BU + Cat L1 (exact matches score higher than &quot;*&quot; wildcards; see
        CLAUDE.md &quot;DeptConfig Matching&quot;).
      </p>
      <div className="mb-3 flex justify-end">
        <button onClick={openAdd} className={buttonPrimary}>
          + Add New Rule
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-brand-muted">No rules configured.</p>
      ) : (
        <div className="mm-table-wrap overflow-x-auto">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Segment</th>
                <th className="px-3 py-2">BU</th>
                <th className="px-3 py-2">Cat L1</th>
                <th className="px-3 py-2">BO Email</th>
                <th className="px-3 py-2">Exceed Amount</th>
                <th className="px-3 py-2">CEO Sig</th>
                <th className="px-3 py-2">Skip BO</th>
                <th className="px-3 py-2">Skip CEO</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{r.dept}</td>
                  <td className="px-3 py-2">{r.bu}</td>
                  <td className="px-3 py-2">{r.cat_l1}</td>
                  <td className="px-3 py-2">{r.bo_email ?? "-"}</td>
                  <td className="px-3 py-2">{r.exceed_amount}</td>
                  <td className="px-3 py-2">{r.ceo_signature_required ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{r.skip_bo ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{r.skip_ceo ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(r)} className="mr-3 text-brand-brown hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="font-medium text-[#DC2626] hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add New Rule" : "Edit Rule"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Segment<RequiredMark /></label>
                <select
                  className={`${inputClass} w-full`}
                  value={form.dept}
                  onChange={(e) => setForm({ ...form, dept: e.target.value })}
                >
                  <option value="*">* All segments</option>
                  {segmentSelectOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>BU</label>
                <select
                  className={`${inputClass} w-full`}
                  value={form.bu}
                  onChange={(e) => setForm({ ...form, bu: e.target.value })}
                >
                  <option value="*">* (All)</option>
                  {BUSINESS_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Cat L1</label>
              <select
                className={`${inputClass} w-full`}
                value={form.cat_l1}
                onChange={(e) => setForm({ ...form, cat_l1: e.target.value })}
              >
                <option value="*">* All</option>
                {catL1SelectOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>BO Email</label>
              <input
                className={`${inputClass} w-full`}
                value={form.bo_email}
                onChange={(e) => setForm({ ...form, bo_email: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Exceed Amount (THB) — 0 = always sign</label>
              <input
                type="number"
                className={`${inputClass} w-full`}
                value={form.exceed_amount}
                onChange={(e) => setForm({ ...form, exceed_amount: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={labelClass}>CEO Signature Required</label>
              <YesNoToggle
                value={form.ceo_signature_required}
                onChange={(v) => setForm({ ...form, ceo_signature_required: v })}
              />
            </div>
            <div>
              <label className={labelClass}>Skip BO</label>
              <YesNoToggle value={form.skip_bo} onChange={(v) => setForm({ ...form, skip_bo: v })} />
            </div>
            <div>
              <label className={labelClass}>Skip CEO</label>
              <YesNoToggle value={form.skip_ceo} onChange={(v) => setForm({ ...form, skip_ceo: v })} />
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 6: Announcements --------------------------------------------

const emptyAnnouncementForm = () => ({
  title: "",
  message: "",
  is_pinned: false,
  attachment_url: "",
  attachment_type: "",
});

const MAX_ANNOUNCEMENT_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function AnnouncementTab() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: number } | null>(null);
  const [form, setForm] = useState(emptyAnnouncementForm());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/announcements?all=1")
      .then((res) => res.json())
      .then((data) => setAnnouncements(data.announcements ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(emptyAnnouncementForm());
    setModal({ mode: "add" });
  };

  const openEdit = (a: AnnouncementRow) => {
    setForm({
      title: a.title,
      message: a.message ?? "",
      is_pinned: a.is_pinned,
      attachment_url: a.attachment_url ?? "",
      attachment_type: a.attachment_type ?? "",
    });
    setModal({ mode: "edit", id: a.id });
  };

  // Uploads to the 'announcements' Supabase Storage bucket (not base64 —
  // unlike every other attachment in this app, this one was explicitly
  // asked to use real Storage this time; see CLAUDE.md "Announcements").
  // Reuses the same generic /api/storage/upload endpoint PDFSigner.tsx
  // uses for the signed-documents bucket.
  const handleAttachmentFile = async (file: File) => {
    if (file.size > MAX_ANNOUNCEMENT_ATTACHMENT_BYTES) {
      alert(`${file.name} is larger than 2MB and can't be attached.`);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("bucket", "announcements");
      formData.append("filename", file.name);
      const res = await fetch("/api/storage/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error([body.error, body.hint].filter(Boolean).join(" — ") || "Failed to upload attachment");
      }
      const { url } = await res.json();
      setForm((f) => ({ ...f, attachment_url: url, attachment_type: file.type }));
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.title.trim()) {
      alert("Title is required");
      return;
    }
    if (!form.message.trim()) {
      alert("Message is required");
      return;
    }
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/announcements/${modal.id}` : "/api/announcements";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save announcement");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save announcement");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (a: AnnouncementRow) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !a.is_active }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to update announcement");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update announcement");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this announcement?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete announcement");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete announcement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={openAdd} className={buttonPrimary}>
          + Add Announcement
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : announcements.length === 0 ? (
        <p className="text-sm text-brand-muted">No announcements yet.</p>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div key={a.id} className="rounded-md border border-brand-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-brand-dark">{a.title}</span>
                    {a.is_pinned && (
                      <span className="rounded-full border border-[#F5C4A3] bg-[#FDF2EE] px-2 py-0.5 text-xs text-[#BD5A2E]">
                        Pinned
                      </span>
                    )}
                    {!a.is_active && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">Inactive</span>
                    )}
                  </div>
                  {a.message && <p className="mt-1 text-sm text-brand-muted">{a.message}</p>}
                  <p className="mt-1 text-xs text-brand-subtle">
                    {a.created_by ?? "-"} — {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button onClick={() => openEdit(a)} className="text-brand-brown hover:underline">
                    Edit
                  </button>
                  <button onClick={() => toggleActive(a)} disabled={busy} className="text-brand-brown hover:underline disabled:opacity-50">
                    {a.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => remove(a.id)}
                    disabled={busy}
                    className="font-medium text-[#DC2626] hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add Announcement" : "Edit Announcement"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Title<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Message<RequiredMark /></label>
              <textarea
                className={`${inputClass} w-full`}
                rows={3}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-brand-dark">
              <input
                type="checkbox"
                checked={form.is_pinned}
                onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
              />
              Pinned (shown first on the homepage)
            </label>
            <div>
              <label className={labelClass}>Photo/File Attachment (jpg, png, gif, pdf — max 2MB)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,application/pdf"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAttachmentFile(file);
                  e.target.value = "";
                }}
                className="text-sm"
              />
              {uploading && <p className="mt-1 text-xs text-brand-subtle">Uploading...</p>}
              {form.attachment_url && (
                <div className="mt-2 flex items-center gap-2">
                  {form.attachment_type.startsWith("image/") ? (
                    // Real Supabase Storage URL ('announcements' bucket), not a data URL —
                    // still a plain <img>, not next/image, since this is a small admin-only
                    // preview thumbnail and not worth remotePatterns config for.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.attachment_url} alt="" className="h-16 w-16 rounded-md border border-brand-border object-cover" />
                  ) : (
                    <span className="text-xs text-brand-muted">📄 PDF attached</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, attachment_url: "", attachment_type: "" })}
                    className="text-xs font-medium text-[#DC2626] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy || uploading} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 7: Petty Cash Custodians --------------------------------------------

const emptyCustodianForm = () => ({
  name: "",
  email: "",
  company: "",
  segment: "",
  amount_limit: 0,
  is_active: true,
});

function PettyCashCustodianTab() {
  const [custodians, setCustodians] = useState<PettyCashCustodianRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [segmentOptions, setSegmentOptions] = useState<string[]>([...DEPARTMENTS]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: number } | null>(null);
  const [form, setForm] = useState(emptyCustodianForm());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/petty-cash-custodians?all=1")
      .then((res) => res.json())
      .then((data) => setCustodians(data.custodians ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(data.companies ?? []));
    fetch("/api/departments")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setSegmentOptions(data.departments?.length ? data.departments : [...DEPARTMENTS]))
      .catch(() => setSegmentOptions([...DEPARTMENTS]));
  }, []);

  const openAdd = () => {
    setForm(emptyCustodianForm());
    setModal({ mode: "add" });
  };

  const openEdit = (c: PettyCashCustodianRow) => {
    setForm({
      name: c.name,
      email: c.email,
      company: c.company,
      segment: c.segment,
      amount_limit: c.amount_limit,
      is_active: c.is_active,
    });
    setModal({ mode: "edit", id: c.id });
  };

  const save = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.company.trim() || !form.segment.trim()) {
      alert("Name, Email, Company, and Segment are required");
      return;
    }
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/petty-cash-custodians/${modal.id}` : "/api/petty-cash-custodians";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save custodian");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save custodian");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this custodian?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/petty-cash-custodians/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete custodian");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete custodian");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: PettyCashCustodianRow) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/petty-cash-custodians/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update custodian");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update custodian");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={openAdd} className={buttonPrimary}>
          + Add Custodian
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : custodians.length === 0 ? (
        <p className="text-sm text-brand-muted">No petty cash custodians yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Segment</th>
                <th className="px-3 py-2">Limit (฿)</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {custodians.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">{c.email}</td>
                  <td className="px-3 py-2">{c.company}</td>
                  <td className="px-3 py-2">{c.segment}</td>
                  <td className="px-3 py-2">{c.amount_limit.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(c)}
                      disabled={busy}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.is_active ? "bg-[#F0F4EF] text-brand-brown" : "bg-[#F3F4F6] text-brand-muted"
                      }`}
                    >
                      {c.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(c)} className="mr-3 text-brand-brown hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => remove(c.id)}
                      className="font-medium text-[#DC2626] hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add Custodian" : "Edit Custodian"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Name<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Email<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Company<RequiredMark /></label>
              <select
                className={`${inputClass} w-full`}
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              >
                <option value="">Select...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.name_en}>{c.bu} — {c.name_en}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Segment<RequiredMark /></label>
              <select
                className={`${inputClass} w-full`}
                value={form.segment}
                onChange={(e) => setForm({ ...form, segment: e.target.value })}
              >
                <option value="">Select...</option>
                {segmentOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount limit (THB)<RequiredMark /></label>
              <input
                type="number"
                className={`${inputClass} w-full`}
                value={form.amount_limit}
                onChange={(e) => setForm({ ...form, amount_limit: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={labelClass}>Active</label>
              <YesNoToggle value={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 8: Companies --------------------------------------------

function CompanyTab() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ id: number } | null>(null);
  const [form, setForm] = useState({ name_en: "", name_th: "", address: "" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(data.companies ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openEdit = (c: CompanyRow) => {
    setForm({ name_en: c.name_en, name_th: c.name_th ?? "", address: c.address });
    setModal({ id: c.id });
  };

  const save = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${modal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name_en: form.name_en,
          name_th: form.name_th || null,
          address: form.address,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save company");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save company");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-3 text-xs text-brand-muted">
        Fixed SV and ONEST companies — no add/delete, only their name/address can be edited.
      </p>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">BU</th>
                <th className="px-3 py-2">Name EN</th>
                <th className="px-3 py-2">Name TH</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.bu}</td>
                  <td className="px-3 py-2">{c.name_en}</td>
                  <td className="px-3 py-2">{c.name_th ?? "-"}</td>
                  <td className="px-3 py-2">{c.address}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(c)} className="text-brand-brown hover:underline">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Edit Company" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Name EN<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Name TH</label>
              <input
                className={`${inputClass} w-full`}
                value={form.name_th}
                onChange={(e) => setForm({ ...form, name_th: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Address<RequiredMark /></label>
              <textarea
                className={`${inputClass} w-full`}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <p className="text-xs text-brand-subtle">
              Fields marked <span style={{ color: "#DC2626" }}>*</span> are required
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className={buttonSecondary}>
                Cancel
              </button>
              <button onClick={save} disabled={busy} className={buttonPrimary}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Tab 9: Permissions --------------------------------------------
//
// SUPERADMIN-only (enforced both client-side, by never appearing in
// visibleTabs for anyone else, and server-side by GET/PATCH
// /api/settings-permissions — see that route). Controls the DB-backed
// settings_tab_permissions config that replaced the old hardcoded
// SETTINGS_TAB_ROLES: which roles can both see AND manage (add/edit/
// delete within) each of the other 8 tabs. This tab itself is never
// listed here — it's excluded from ManagedSettingsTab entirely (see
// lib/permissions.ts) precisely so it can't be reconfigured through
// itself.
//
// SUPERADMIN is never shown as a toggle — it always has full access to
// every tab regardless of what's configured here (canAccessSettingsTab's
// unconditional bypass). EMPLOYEE is excluded too since Settings itself
// is already unreachable for a pure EMPLOYEE (canAccessPage).
//
// Reuses the same toggle-button visual style as User Management's "BU
// Scope" buttons (bordered pill, brand-brown fill + white text when
// active) for consistency — but NOT its exclusive/single-select click
// behavior (each BU Scope click replaces the whole value with just that
// one option). A tab can need several roles active simultaneously today
// (e.g. suppliers: ACCOUNTING and PROCUREMENT both), so each button here
// independently toggles its own role in/out of that tab's list instead,
// the same add/remove logic ScopeMultiSelect already uses for Segment
// Scope, just rendered as a flat always-visible row rather than a
// collapsible searchable dropdown (overkill for only 6 roles).
