import { STATUS_LABELS } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

// Exact hex per the Mimetta brand palette (see CLAUDE.md "Brand") — inline
// styles rather than Tailwind classes since these are specific values, not
// the generic brand tokens in tailwind.config.ts.
const COLORS: Record<ExpenseRequest["status"], { background: string; color: string }> = {
  SUBMITTED: { background: "#EDE6D8", color: "#1A1A1A" },
  PO_UPLOADED: { background: "#DBEAFE", color: "#1E40AF" },
  BO_APPROVED: { background: "#D8CBB0", color: "#1F3A2B" },
  CEO_APPROVED: { background: "#1F3A2B", color: "#FFFFFF" },
  PAID: { background: "#9CAE8C", color: "#1F3A2B" },
  REJECTED: { background: "#FEE2E2", color: "#991B1B" },
};

export default function StatusBadge({ status }: { status: ExpenseRequest["status"] }) {
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={COLORS[status]}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
