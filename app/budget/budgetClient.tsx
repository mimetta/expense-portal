"use client";

import { useEffect, useState } from "react";
import PLTable from "@/components/budget/PLTable";
import type { PLData } from "@/lib/budget/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function BudgetClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<PLData | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/budget/data?year=${year}&month=${month}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load budget data");
        return r.json();
      })
      .then((res) => {
        setData(res.data);
        setRole(res.role);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-medium text-brand-brown">Budget — Onest</h1>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border border-brand-border px-2 py-1 text-sm"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-brand-border px-2 py-1 text-sm"
          >
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-brand-muted">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && data && (
        <PLTable
          period1={{ label: `${MONTH_NAMES[month - 1]} ${year}`, data }}
          role={role ?? undefined}
        />
      )}
    </div>
  );
}
