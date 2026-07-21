import { STATUS_LABELS } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

// Exact hex per the Mimetta design system spec (see CLAUDE.md "UI Design
// System") — inline styles rather than Tailwind classes since these are
// specific per-status values, not the generic brand tokens in
// tailwind.config.ts.
const COLORS: Record<ExpenseRequest["status"], { background: string; color: string; border?: string }> = {
  SUBMITTED: { background: "#F3F4F6", color: "#374151", border: "#E5E7EB" },
  PO_UPLOADED: { background: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
  BO_APPROVED: { background: "#F0F4EF", color: "#1F3A2B", border: "#9CAE8C" },
  CEO_APPROVED: { background: "#1F3A2B", color: "#FFFFFF" },
  PAID: { background: "#9CAE8C", color: "#1F3A2B" },
  REJECTED: { background: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
  EDIT_REQUESTED: { background: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
  // Historical only (imported legacy rows) — muted grey, distinct from the
  // active SUBMITTED grey via a visible border, since nothing currently
  // produces this status going forward. See lib/constants.ts#STATUSES.
  EXPIRED: { background: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" },
};

export default function StatusBadge({ status }: { status: ExpenseRequest["status"] }) {
  const { border, ...colors } = COLORS[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ ...colors, border: border ? `1px solid ${border}` : undefined }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
