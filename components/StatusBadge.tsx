import { STATUS_LABELS } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

// Exact hex per the Supabase-inspired redesign spec (see CLAUDE.md "Brand" /
// "UI redesign") — inline styles rather than Tailwind classes since these
// are specific per-status values, not the generic brand tokens in
// tailwind.config.ts. Supersedes the slightly different values from the
// previous rebrand pass (e.g. SUBMITTED moved from cream to a muted grey,
// matching this pass's "muted colors, not loud" badge principle).
const COLORS: Record<ExpenseRequest["status"], { background: string; color: string; border?: string }> = {
  SUBMITTED: { background: "#F3F4F6", color: "#374151", border: "#E5E7EB" },
  PO_UPLOADED: { background: "#DBEAFE", color: "#1D4ED8" },
  BO_APPROVED: { background: "#D8CBB0", color: "#1F3A2B" },
  CEO_APPROVED: { background: "#1F3A2B", color: "#FFFFFF" },
  PAID: { background: "#9CAE8C", color: "#1F3A2B" },
  REJECTED: { background: "#FEE2E2", color: "#DC2626" },
  // Not specified in the redesign spec (which only listed the original six
  // statuses) — reuses this app's existing "needs attention" amber pairing
  // (see the auto-registration banner in components/Nav.tsx) rather than
  // inventing an unrelated new color for the same meaning.
  EDIT_REQUESTED: { background: "#FEF3C7", color: "#92400E" },
};

export default function StatusBadge({ status }: { status: ExpenseRequest["status"] }) {
  const { border, ...colors } = COLORS[status];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ ...colors, border: border ? `1px solid ${border}` : undefined }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
