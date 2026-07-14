"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import RequiredMark from "@/components/shared/RequiredMark";
import { BANK_OPTIONS, BUSINESS_UNITS, DEPARTMENTS, PAYMENT_METHODS, ROLES, type Role } from "@/lib/constants";
import { canAccessSettingsTab, firstAccessibleSettingsTab, SETTINGS_TABS, type SettingsTab } from "@/lib/permissions";
import type {
  AnnouncementRow,
  CategoryRow,
  CurrentUser,
  DeptConfigRow,
  ProductRow,
  RoleRow,
  SupplierRow,
} from "@/types/database";

type Tab = SettingsTab;

const TAB_LABELS: Record<Tab, string> = {
  suppliers: "Supplier Management",
  users: "User Management",
  products: "Product/SKU Management",
  categories: "Category L1/L2 Management",
  deptconfig: "CEO Signature Rules",
  announcements: "Announcements",
};

// Order/membership comes from lib/permissions.ts#SETTINGS_TABS — the same
// list the server-side permission checks are built from — rather than a
// second, independently-maintained array here.
const TABS: { key: Tab; label: string }[] = SETTINGS_TABS.map((key) => ({ key, label: TAB_LABELS[key] }));

// "Pending" per spec: role = EMPLOYEE, created within the last 7 days, and
// this is the user's *only* roles row (i.e. nobody has added a second role
// for them, which would mean someone already looked at their access).
// Shared by the tab badge count (a lightweight roles fetch in
// SettingsClient below) and the Pending Users section inside UserTab
// (which already loads the full roles list for its own table).
const PENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getPendingUsers(roles: RoleRow[]): RoleRow[] {
  const rowCountByEmail = new Map<string, number>();
  for (const r of roles) {
    rowCountByEmail.set(r.email, (rowCountByEmail.get(r.email) ?? 0) + 1);
  }
  return roles.filter(
    (r) =>
      r.role === "EMPLOYEE" &&
      rowCountByEmail.get(r.email) === 1 &&
      !!r.created_at &&
      Date.now() - new Date(r.created_at).getTime() < PENDING_WINDOW_MS,
  );
}

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
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user as CurrentUser);
      })
      .finally(() => setUserLoading(false));
  }, []);

  const visibleTabs = useMemo(
    () => (currentUser ? TABS.filter((t) => canAccessSettingsTab(currentUser, t.key)) : []),
    [currentUser],
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
    const requestedIsValid = !!requested && canAccessSettingsTab(currentUser, requested);
    const resolved = requestedIsValid ? (requested as Tab) : firstAccessibleSettingsTab(currentUser);
    setTabState(resolved);
    if (resolved && resolved !== requested) {
      window.history.replaceState(null, "", `/settings?tab=${resolved}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Lightweight, badge-only roles fetch — independent of UserTab's own
  // fetch for its table, so the "New (X)" count is visible on the tab
  // button regardless of which tab is currently open.
  useEffect(() => {
    if (!currentUser || !canAccessSettingsTab(currentUser, "users")) return;
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data) => setPendingCount(getPendingUsers(data.roles ?? []).length));
  }, [currentUser]);

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
            {t.key === "users" && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                New ({pendingCount})
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "suppliers" && <SupplierTab />}
      {tab === "users" && <UserTab />}
      {tab === "products" && <ProductTab />}
      {tab === "categories" && <CategoryTab />}
      {tab === "deptconfig" && <DeptConfigTab />}
      {tab === "announcements" && <AnnouncementTab />}
    </div>
  );
}

// --- Tab 1: Supplier Management --------------------------------------------

const emptySupplierForm = () => ({
  name: "",
  payment_method: "",
  bank_name: "",
  account_no: "",
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

// --- Tab 2: User Management --------------------------------------------

const emptyRoleForm = () => ({
  email: "",
  role: "EMPLOYEE" as Role,
  bu_scope: "*",
  dept_scope: "*",
  cat_l1_scope: "*",
  chapter: "",
});

// Multi-select combobox for a scope field: a "select all" checkbox that
// stores "*" and disables the individual options, or a comma-joined string
// of whichever specific options are checked. Shared by Segment Scope and
// Cat L1 Scope below — same interaction pattern, different option lists.
function ScopeMultiSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isAll = value === "*";
  const selected = isAll ? [] : value.split(",").map((s) => s.trim()).filter(Boolean);
  const filteredOptions = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const summary = isAll ? allLabel : selected.length > 0 ? selected.join(", ") : "None selected";

  const toggleValue = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
    onChange(next.join(","));
  };

  return (
    <div ref={containerRef} className="relative">
      <label className={labelClass}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between text-left`}
      >
        <span className="truncate">{summary}</span>
        <span className="ml-2 text-brand-subtle">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-brand-border bg-white shadow-lg">
          <div className="border-b border-brand-border p-2">
            <input
              className={`${inputClass} w-full`}
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-2">
            <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[#F9F8F6]">
              <input
                type="checkbox"
                checked={isAll}
                onChange={(e) => onChange(e.target.checked ? "*" : selected.join(","))}
              />
              <span className="font-medium">{allLabel}</span>
            </label>
            <div className="my-1 border-t border-brand-border" />
            {filteredOptions.length === 0 ? (
              <p className="px-1 py-1 text-xs text-brand-subtle">No options</p>
            ) : (
              filteredOptions.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[#F9F8F6] ${
                    isAll ? "opacity-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    disabled={isAll}
                    onChange={() => toggleValue(opt)}
                  />
                  <span>{opt}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Grouped-checkbox variant of the Cat L1 Scope picker: cat_l1 values grouped
// by Segment (categories.department), each group collapsible with a "select
// all in segment" checkbox and a selected-count badge, plus a top-level "*
// All categories" that supersedes everything. Same "*"-or-comma-joined-list
// value convention as ScopeMultiSelect, so the stored roles.cat_l1_scope
// format doesn't change — only the picker UI does.
function CatL1ScopeGrouped({
  categories,
  buScope,
  deptScope,
  value,
  onChange,
}: {
  categories: CategoryRow[];
  buScope: string;
  deptScope: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);

  const isAll = value === "*";
  const selected = useMemo(
    () => (isAll ? [] : value.split(",").map((s) => s.trim()).filter(Boolean)),
    [isAll, value],
  );

  // Narrow available cat_l1 values to the BU/Segment scope currently picked
  // elsewhere in the same modal — same '*'-wildcard-or-list convention used
  // throughout this schema. Recomputes (and the whole group list refreshes)
  // whenever BU Scope or Segment Scope changes.
  const scopedBus = buScope === "*" ? null : buScope.split(",").map((s) => s.trim()).filter(Boolean);
  const scopedDepts = deptScope === "*" ? null : deptScope.split(",").map((s) => s.trim()).filter(Boolean);

  const groups = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of categories) {
      if (!c.cat_l1) continue;
      if (scopedBus && c.bu !== "*" && !scopedBus.includes(c.bu)) continue;
      if (scopedDepts && c.department !== "*" && !scopedDepts.includes(c.department)) continue;
      const key = c.department || "(No Segment)";
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(c.cat_l1);
    }
    return Array.from(map.entries())
      .map(([segment, set]) => ({ segment, catL1s: Array.from(set).sort() }))
      .sort((a, b) => a.segment.localeCompare(b.segment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, buScope, deptScope]);

  // On edit (existing comma-separated value), auto-expand whichever segment
  // groups contain a checked cat_l1 — runs once, as soon as categories have
  // loaded, so it doesn't fight the user's own expand/collapse clicks
  // afterward.
  useEffect(() => {
    if (didInitExpand.current || categories.length === 0) return;
    didInitExpand.current = true;
    if (!isAll) {
      const toExpand = new Set(
        groups.filter((g) => g.catL1s.some((c) => selected.includes(c))).map((g) => g.segment),
      );
      setExpanded(toExpand);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length]);

  const toggleAll = (checked: boolean) => {
    onChange(checked ? "*" : "");
    if (checked) setExpanded(new Set());
  };

  const toggleSegmentAll = (catL1s: string[], checked: boolean) => {
    const withoutSegment = selected.filter((c) => !catL1s.includes(c));
    onChange((checked ? [...withoutSegment, ...catL1s] : withoutSegment).join(","));
  };

  const toggleOne = (cat: string, checked: boolean) => {
    onChange((checked ? [...selected, cat] : selected.filter((c) => c !== cat)).join(","));
  };

  const toggleExpand = (segment: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(segment)) next.delete(segment);
      else next.add(segment);
      return next;
    });
  };

  return (
    <div>
      <label className={labelClass}>Cat L1 Scope</label>
      <div className="rounded-md border border-brand-border bg-white">
        <label className="flex items-center gap-2 border-b border-brand-border px-2 py-1.5 text-sm hover:bg-[#F9F8F6]">
          <input type="checkbox" checked={isAll} onChange={(e) => toggleAll(e.target.checked)} />
          <span className="font-medium">* All categories</span>
        </label>
        <div className="max-h-64 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-2 py-2 text-xs text-brand-subtle">
              No categories match the current BU/Segment scope.
            </p>
          ) : (
            groups.map(({ segment, catL1s }) => {
              const selectedCount = isAll ? catL1s.length : catL1s.filter((c) => selected.includes(c)).length;
              const allSelected = selectedCount === catL1s.length;
              const isExpanded = expanded.has(segment);
              return (
                <div key={segment} className="border-b border-brand-border last:border-b-0">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <button
                      type="button"
                      onClick={() => toggleExpand(segment)}
                      className="w-3 text-brand-subtle"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? "▼" : "▶"}
                    </button>
                    <input
                      type="checkbox"
                      checked={isAll || allSelected}
                      disabled={isAll}
                      onChange={(e) => toggleSegmentAll(catL1s, e.target.checked)}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpand(segment)}
                      className="flex-1 text-left font-medium text-brand-dark"
                    >
                      {segment}
                    </button>
                    <span className="text-xs text-brand-subtle">
                      ({selectedCount}/{catL1s.length})
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="space-y-0.5 pb-1 pl-8 pr-2">
                      {catL1s.map((cat) => (
                        <label
                          key={cat}
                          className={`flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[#F9F8F6] ${
                            isAll ? "opacity-50" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isAll || selected.includes(cat)}
                            disabled={isAll}
                            onChange={(e) => toggleOne(cat, e.target.checked)}
                          />
                          <span>{cat}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function UserTab() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; id?: string } | null>(null);
  const [form, setForm] = useState(emptyRoleForm());
  const [busy, setBusy] = useState(false);

  // Reference data for the scope/chapter pickers in the Add/Edit User
  // modal — same /api/departments and /api/categories endpoints /submit
  // uses for its own pickers, plus /api/roles?distinct=chapter for the
  // Chapter combobox's known values.
  const [segmentOptions, setSegmentOptions] = useState<string[]>([...DEPARTMENTS]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [chapterOptions, setChapterOptions] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data) => setRoles(data.roles ?? []))
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
    fetch("/api/roles?distinct=chapter")
      .then((res) => res.json())
      .then((data) => setChapterOptions(data.chapters ?? []));
  }, []);

  const openAdd = () => {
    setForm(emptyRoleForm());
    setModal({ mode: "add" });
  };

  const openEdit = (r: RoleRow) => {
    setForm({
      email: r.email,
      role: r.role,
      bu_scope: r.bu_scope,
      dept_scope: r.dept_scope,
      cat_l1_scope: r.cat_l1_scope,
      chapter: r.chapter ?? "",
    });
    setModal({ mode: "edit", id: r.id });
  };

  const save = async () => {
    if (!form.email.trim()) {
      alert("Email is required");
      return;
    }
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/roles/${modal.id}` : "/api/roles";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save user");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this role row?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/roles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to remove role");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove role");
    } finally {
      setBusy(false);
    }
  };

  const pendingUsers = useMemo(() => getPendingUsers(roles), [roles]);

  return (
    <div>
      {pendingUsers.length > 0 && (
        <div className="mb-4 rounded-md border p-3" style={{ background: "#FEF3C7", borderColor: "#F59E0B" }}>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "#92400E" }}>
            Pending Users ({pendingUsers.length})
          </h3>
          <ul className="space-y-1.5">
            {pendingUsers.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span className="text-brand-dark">{r.email}</span>
                <button onClick={() => openEdit(r)} className="font-medium text-brand-brown hover:underline">
                  Assign Role
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <button onClick={openAdd} className={buttonPrimary}>
          + Add User
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-brand-muted">No roles configured.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Chapter</th>
                <th className="px-3 py-2">BU Scope</th>
                <th className="px-3 py-2">Seg Scope</th>
                <th className="px-3 py-2">Cat L1 Scope</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.role}</td>
                  <td className="px-3 py-2">
                    {r.chapter ? r.chapter : <span className="text-brand-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2">{r.bu_scope}</td>
                  <td className="px-3 py-2">{r.dept_scope}</td>
                  <td className="px-3 py-2">{r.cat_l1_scope}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(r)} className="mr-3 text-brand-brown hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="font-medium text-[#DC2626] hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add User" : "Edit User"} onClose={() => setModal(null)} wide>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Email<RequiredMark /></label>
              <input
                className={`${inputClass} w-full`}
                placeholder="name@mimetta.co"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <select
                className={`${inputClass} w-full`}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Chapter</label>
              <input
                className={`${inputClass} w-full`}
                list="chapter-options"
                placeholder="Pick an existing chapter or type a new one"
                value={form.chapter}
                onChange={(e) => setForm({ ...form, chapter: e.target.value })}
              />
              <datalist id="chapter-options">
                {chapterOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>BU Scope</label>
              <div className="flex gap-2">
                {["*", ...BUSINESS_UNITS].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setForm({ ...form, bu_scope: opt })}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      form.bu_scope === opt
                        ? "border-brand-brown bg-brand-brown text-white"
                        : "border-brand-border bg-white text-brand-dark hover:bg-[#F9F8F6]"
                    }`}
                  >
                    {opt === "*" ? "All BUs" : opt}
                  </button>
                ))}
              </div>
            </div>
            <ScopeMultiSelect
              label="Segment Scope"
              allLabel="* All segments"
              options={segmentOptions}
              value={form.dept_scope}
              onChange={(v) => setForm({ ...form, dept_scope: v })}
            />
            <CatL1ScopeGrouped
              categories={categories}
              buScope={form.bu_scope}
              deptScope={form.dept_scope}
              value={form.cat_l1_scope}
              onChange={(v) => setForm({ ...form, cat_l1_scope: v })}
            />
            <p className="text-xs text-brand-muted">
              Scopes only matter for the BO role. Multi-role users get one row per role (see CLAUDE.md).
            </p>
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

// --- Tab 3: Product/SKU Management --------------------------------------------

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
                  <td className="px-3 py-2 font-mono text-xs">{p.sku_code ?? "-"}</td>
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
              <label className={labelClass}>Segment</label>
              <select
                className={`${inputClass} w-full`}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              >
                <option value="">-</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Business Unit</label>
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

  const load = () => {
    setLoading(true);
    fetch("/api/categories")
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

  const save = async () => {
    setBusy(true);
    try {
      const url = modal?.mode === "edit" ? `/api/categories/${modal.id}` : "/api/categories";
      const method = modal?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save category");
      }
      setModal(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save category");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category row?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete category");
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
      <div className="mb-3 flex justify-between">
        <button onClick={() => setBulkOpen(true)} className={buttonSecondary}>
          Bulk Import
        </button>
        <button onClick={openAdd} className={buttonPrimary}>
          + Add New Category
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-brand-muted">No categories yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead className="bg-[#F9F8F6] text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">BU</th>
                <th className="px-3 py-2">Segment</th>
                <th className="px-3 py-2">Cat L1</th>
                <th className="px-3 py-2">Cat L2</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.bu}</td>
                  <td className="px-3 py-2">{c.department}</td>
                  <td className="px-3 py-2">{c.cat_l1 ?? "-"}</td>
                  <td className="px-3 py-2">{c.cat_l2 ?? "-"}</td>
                  <td className="px-3 py-2">{c.product ?? "-"}</td>
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

  const load = () => {
    setLoading(true);
    fetch("/api/dept-config")
      .then((res) => res.json())
      .then((data) => setRows(data.dept_config ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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
                  <option value="*">* (all segments)</option>
                  {DEPARTMENTS.map((d) => (
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
                  <option value="*">*</option>
                  {BUSINESS_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Cat L1 (or * for all)</label>
              <input
                className={`${inputClass} w-full`}
                value={form.cat_l1}
                onChange={(e) => setForm({ ...form, cat_l1: e.target.value })}
              />
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
