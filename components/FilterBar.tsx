"use client";

import { useEffect, useMemo, useState } from "react";
import { EXPENSE_TYPES, PAYMENT_METHODS, STATUSES, type Status } from "@/lib/constants";
import { STATUS_LABELS } from "@/lib/status";
import type { CategoryRow, ExpenseRequest, SupplierRow } from "@/types/database";

const selectClass =
  "rounded-md border border-brand-border bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-brown";

interface FilterBarProps {
  requests: ExpenseRequest[];
  onFilteredChange: (filtered: ExpenseRequest[]) => void;
  // Restrict the Status dropdown to what's relevant on this page (defaults
  // to every status). Applied client-side to already-loaded data — no new
  // API calls.
  statuses?: readonly Status[];
}

export default function FilterBar({ requests, onFilteredChange, statuses = STATUSES }: FilterBarProps) {
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

  const clear = () => {
    setMonth("");
    setStatus("");
    setCatL1("");
    setExpenseType("");
    setPayMethod("");
    setSupplier("");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-brand-border bg-white p-2">
      <input
        type="month"
        className={selectClass}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        title="Budget period"
      />
      <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>
      <select className={selectClass} value={catL1} onChange={(e) => setCatL1(e.target.value)}>
        <option value="">All categories</option>
        {catL1Options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select className={selectClass} value={expenseType} onChange={(e) => setExpenseType(e.target.value)}>
        <option value="">All expense types</option>
        {EXPENSE_TYPES.map((t) => (
          <option key={t.label} value={t.label}>{t.label}</option>
        ))}
      </select>
      <select className={selectClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
        <option value="">All payment methods</option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select className={selectClass} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
        <option value="">All suppliers</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.name}>{s.name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={clear}
        className="text-sm text-[#1F3A2B] hover:underline"
      >
        ↺ Reset
      </button>
    </div>
  );
}
