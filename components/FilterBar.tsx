"use client";

import { useEffect, useMemo, useState } from "react";
import { EXPENSE_TYPES, PAYMENT_METHODS, STATUSES, type Status } from "@/lib/constants";
import { STATUS_LABELS } from "@/lib/status";
import type { CategoryRow, ExpenseRequest, SupplierRow } from "@/types/database";

const selectClass =
  "h-8 rounded-md border border-brand-border bg-white px-2 text-[13px] text-brand-dark focus:border-brand-brown focus:outline-none";
const labelClass = "mb-1 block text-[11px] text-gray-500";

interface FilterBarProps {
  requests: ExpenseRequest[];
  onFilteredChange: (filtered: ExpenseRequest[]) => void;
  // Restrict the Status dropdown to what's relevant on this page (defaults
  // to every status). Applied client-side to already-loaded data — no new
  // API calls.
  statuses?: readonly Status[];
}

export default function FilterBar({ requests, onFilteredChange, statuses = STATUSES }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [catL1, setCatL1] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [supplier, setSupplier] = useState("");

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []));
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => setSuppliers(data.suppliers ?? []));
  }, []);

  const catL1Options = useMemo(
    () => Array.from(new Set(categories.map((c) => c.cat_l1).filter(Boolean))) as string[],
    [categories],
  );

  const filtered = useMemo(
    () =>
      requests.filter(
        (r) =>
          (!month || r.budget_period === month) &&
          (!status || r.status === status) &&
          (!catL1 || r.cat_l1 === catL1) &&
          (!expenseType || r.expense_type === expenseType) &&
          (!payMethod || r.pay_method === payMethod) &&
          (!supplier || r.supplier_name === supplier),
      ),
    [requests, month, status, catL1, expenseType, payMethod, supplier],
  );

  useEffect(() => {
    onFilteredChange(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const activeCount = [month, status, catL1, expenseType, payMethod, supplier].filter(Boolean).length;

  const clear = () => {
    setMonth("");
    setStatus("");
    setCatL1("");
    setExpenseType("");
    setPayMethod("");
    setSupplier("");
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mm-btn-secondary mm-btn-sm"
        >
          🔽 Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-[13px] font-medium text-[#BD5A2E] hover:underline"
          >
            ↺ Clear all
          </button>
        )}
      </div>

      {open && (
        <div className="mm-card mt-2 flex flex-wrap items-end gap-3 !p-4">
          <div>
            <label className={labelClass}>Month</label>
            <input
              type="month"
              className={selectClass}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <select className={selectClass} value={catL1} onChange={(e) => setCatL1(e.target.value)}>
              <option value="">All</option>
              {catL1Options.map((c) => (
                <option key={c} value={c}>{c}</option>
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
        </div>
      )}
    </div>
  );
}
