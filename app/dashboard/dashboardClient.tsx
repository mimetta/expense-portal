"use client";

import { useEffect, useMemo, useState } from "react";
import { BUSINESS_UNITS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface BudgetRow {
  bu: string;
  department: string;
  responsibility: string | null;
  cat_l1: string | null;
  cat_l2: string | null;
  budget: number[];
  actual: number[];
}

interface RevenueRow {
  bu: string;
  year: number;
  month: string;
  amount: number;
}

export default function DashboardPage() {
  const [bu, setBu] = useState<string>("ALL");
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = bu === "ALL" ? "" : `?bu=${bu}`;
    Promise.all([
      fetch(`/api/dashboard/budget${qs}`).then((r) => r.json()),
      fetch(`/api/dashboard/revenue${qs}`).then((r) => r.json()),
    ])
      .then(([budgetData, revenueData]) => {
        setRows(budgetData.rows ?? []);
        setRevenue(revenueData.revenue ?? []);
      })
      .finally(() => setLoading(false));
  }, [bu]);

  const monthlyBudget = useMemo(() => {
    const totals = new Array(12).fill(0);
    rows.forEach((r) => r.budget.forEach((v, i) => (totals[i] += v)));
    return totals;
  }, [rows]);

  const monthlyActual = useMemo(() => {
    const totals = new Array(12).fill(0);
    rows.forEach((r) => r.actual.forEach((v, i) => (totals[i] += v)));
    return totals;
  }, [rows]);

  // revenue.month format is assumed to match budget_2026's "jan".."dec" keys
  // for consistency across the schema — adjust the mapping here if the
  // migrated data uses a different convention (e.g. "01" or "January").
  const monthlyRevenue = useMemo(() => {
    const totals = new Array(12).fill(0);
    const keys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    revenue.forEach((r) => {
      const idx = keys.indexOf(r.month.toLowerCase().slice(0, 3));
      if (idx >= 0) totals[idx] += r.amount;
    });
    return totals;
  }, [revenue]);

  const maxValue = Math.max(1, ...monthlyBudget, ...monthlyActual, ...monthlyRevenue);
  const totalBudget = monthlyBudget.reduce((a, b) => a + b, 0);
  const totalActual = monthlyActual.reduce((a, b) => a + b, 0);
  const totalRevenue = monthlyRevenue.reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-dark">Dashboard — 2026</h1>
        <select
          className="rounded-md border border-brand-border px-3 py-1.5 text-sm"
          value={bu}
          onChange={(e) => setBu(e.target.value)}
        >
          <option value="ALL">All BUs</option>
          {BUSINESS_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-brand-dark/60">Loading...</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-md border border-brand-border p-4">
              <p className="text-xs text-brand-dark/60">Budget (2026)</p>
              <p className="text-xl font-semibold text-brand-dark">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="rounded-md border border-brand-border p-4">
              <p className="text-xs text-brand-dark/60">Actual Spend (Paid)</p>
              <p className="text-xl font-semibold text-brand-dark">{formatCurrency(totalActual)}</p>
            </div>
            <div className="rounded-md border border-brand-border p-4">
              <p className="text-xs text-brand-dark/60">Revenue</p>
              <p className="text-xl font-semibold text-brand-dark">{formatCurrency(totalRevenue)}</p>
            </div>
          </div>

          <div className="mb-6 rounded-md border border-brand-border p-4">
            <h2 className="mb-3 font-semibold text-brand-dark">Monthly Trend</h2>
            <div className="mb-2 flex gap-4 text-xs text-brand-dark/70">
              <span><span className="inline-block h-2 w-2 rounded-full bg-brand-brown" /> Budget</span>
              <span><span className="inline-block h-2 w-2 rounded-full bg-teal-500" /> Actual</span>
              <span><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Revenue</span>
            </div>
            <div className="flex items-end gap-2" style={{ height: 160 }}>
              {MONTH_LABELS.map((label, i) => (
                <div key={label} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end gap-0.5">
                    <div
                      className="flex-1 rounded-t bg-brand-brown"
                      style={{ height: `${(monthlyBudget[i] / maxValue) * 100}%` }}
                    />
                    <div
                      className="flex-1 rounded-t bg-teal-500"
                      style={{ height: `${(monthlyActual[i] / maxValue) * 100}%` }}
                    />
                    <div
                      className="flex-1 rounded-t bg-amber-500"
                      style={{ height: `${(monthlyRevenue[i] / maxValue) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-brand-dark/60">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-brand-border">
            <table className="w-full text-sm">
              <thead className="bg-brand-cream text-left text-brand-dark">
                <tr>
                  <th className="px-3 py-2">BU</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Cat L1</th>
                  <th className="px-3 py-2">Budget</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2">% Used</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const rowBudget = row.budget.reduce((a, b) => a + b, 0);
                  const rowActual = row.actual.reduce((a, b) => a + b, 0);
                  const pct = rowBudget > 0 ? Math.round((rowActual / rowBudget) * 100) : 0;
                  return (
                    <tr key={i} className="border-t border-brand-border">
                      <td className="px-3 py-2">{row.bu}</td>
                      <td className="px-3 py-2">{row.department}</td>
                      <td className="px-3 py-2">{row.cat_l1 ?? "-"}</td>
                      <td className="px-3 py-2">{formatCurrency(rowBudget)}</td>
                      <td className="px-3 py-2">{formatCurrency(rowActual)}</td>
                      <td className="px-3 py-2">
                        <span className={pct > 100 ? "text-red-600" : "text-brand-dark"}>{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
