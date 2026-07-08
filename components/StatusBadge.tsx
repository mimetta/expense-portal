import { STATUS_LABELS } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

const COLORS: Record<ExpenseRequest["status"], string> = {
  SUBMITTED: "bg-blue-100 text-blue-800",
  PO_UPLOADED: "bg-purple-100 text-purple-800",
  BO_APPROVED: "bg-amber-100 text-amber-800",
  CEO_APPROVED: "bg-teal-100 text-teal-800",
  PAID: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default function StatusBadge({ status }: { status: ExpenseRequest["status"] }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
