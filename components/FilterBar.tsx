"use client";

import { useEffect, useMemo, useState } from "react";
import { DEPARTMENTS, EXPENSE_TYPES, PAYMENT_METHODS, type Status } from "@/lib/constants";
import type { CompanyRow, ExpenseRequest, SupplierRow } from "@/types/database";

const selectClass =
  "h-[30px] rounded-md border border-brand-border bg-white px-2 text-xs text-brand-dark focus:border-brand-brown focus:outline-none";
const labelClass = "mb-1 block text-[10px] uppercase tracking-wide text-brand-subtle";

// Same label convention as RequestForm.tsx's companyOptionLabel, e.g.
// "ONEST — Mimetta Co., Ltd." — kept as a local copy here rather than a
// shared export since it's a one-line formatter, not worth a new module.
function companyOptionLabel(c: CompanyRow): string {
  return `${c.bu} — ${c.name_en}`;
}

interface FilterBarProps {
  requests: ExpenseRequest[];
  onFilteredChange: (filtered: ExpenseRequest[]) => void;
  // Restrict the Status dropdown to what's relevant on this page (defaults
  // to every status). Applied client-side to already-loaded data — no new
  // API calls.
  statuses?: readonly Status[];
}

function AdjustmentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function FilterBar({ requests, onFilteredChange }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [segment, setSegment] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [supplier, setSupplier] = useState("");
  // Matches the year-month portion of due_date, same "month picker"
  // convention as the Submitted Month filter above (which matches
  // budget_period the same way) — an exact-date picker would be too narrow
  // given due_date is usually being scanned for "what's due this month",
  // not one exact day.
  const [dueDateMonth, setDueDateMonth] = useState("");
  // Matches requests.use_for_company (a companies.bu value — see
  // "Use for company" on RequestForm.tsx) — deliberately not the same
  // field as Segment above, which matches requests.department.
  const [company, setCompany] = useState("");

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  // Segment options — same /api/departments-with-DEPARTMENTS-fallback
  // convention used by RequestForm.tsx and settingsClient.tsx, rather than
  // deriving options from categories (which is what the old Category filter
  // used) — Segment here means requests.department (see RequestItem.segment
  // in types/database.ts), a different field than cat_l1.
  const [segmentOptions, setSegmentOptions] = useState<string[]>([...DEPARTMENTS]);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []));
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => setSegmentOptions(data.departments?.length ? data.departments : [...DEPARTMENTS]))
      .catch(() => setSegmentOptions([...DEPARTMENTS]));
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(data.companies ?? []));
  }, []);

  const filtered = useMemo(
    () =>
      requests.filter(
        (r) =>
          (!month || r.budget_period === month) &&
          (!segment || r.department === segment) &&
          (!expenseType || r.expense_type === expenseType) &&
          (!payMethod || r.pay_method === payMethod) &&
          (!supplier || r.supplier_name === supplier) &&
          (!dueDateMonth || (!!r.due_date && r.due_date.slice(0, 7) === dueDateMonth)) &&
          (!company || r.use_for_company === company),
      ),
    [requests, month, segment, expenseType, payMethod, supplier, dueDateMonth, company],
  );

  useEffect(() => {
    onFilteredChange(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const activeCount = [month, segment, expenseType, payMethod, supplier, dueDateMonth, company].filter(
    Boolean,
  ).length;

  const clear = () => {
    setMonth("");
    setSegment("");
    setExpenseType("");
    setPayMethod("");
    setSupplier("");
    setDueDateMonth("");
    setCompany("");
  };

  return (
    <div className="mb-4 overflow-hidden rounded-[10px] border border-[#F0EAE0]" style={{ background: "#FDFCFB" }}>
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`mm-btn-sm inline-flex items-center gap-1.5 rounded-md border transition-colors ${
              activeCount > 0
                ? "border-brand-brown bg-brand-brown text-white"
                : "border-brand-border bg-white text-brand-dark hover:bg-[#F9F8F6]"
            }`}
          >
            <AdjustmentsIcon />
            {activeCount > 0 ? `Filter (${activeCount})` : "Filter"}
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clear}
              className="text-[13px] font-medium text-[#BD5A2E] hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
        <span className="text-[13px] text-brand-subtle">{filtered.length} results</span>
      </div>

      <div
        className="overflow-hidden"
        style={{ maxHeight: open ? 76 : 0, transition: "max-height 0.2s ease" }}
      >
        <div className="flex flex-nowrap items-end gap-3 overflow-x-auto px-5 pb-4 pt-1">
          <div>
            <label className={labelClass}>Submitted month</label>
            <input
              type="month"
              className={selectClass}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Segment</label>
            <select className={selectClass} value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">All</option>
              {segmentOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Expense Type</label>
            <select className={selectClass} value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>
              <option value="">All</option>
              {EXPENSE_TYPES.map((t) => (
                <option key={t.label} value={t.label}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Payment Method</label>
            <select className={selectClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="">All</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Supplier</label>
            <select className={selectClass} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">All</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Due Date</label>
            <input
              type="month"
              className={selectClass}
              value={dueDateMonth}
              onChange={(e) => setDueDateMonth(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <select className={selectClass} value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">All</option>
              {companies.map((c) => (
                <option key={c.id} value={c.bu}>{companyOptionLabel(c)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
