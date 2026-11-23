import { STATUS_LABELS } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

// Every value is an app token (app/tokens.css), which is in turn a
// Kindfolks kit palette colour — no hex here. Inline styles rather than
// Tailwind classes because the pair is chosen per status at runtime.
//
// The pills are the kit's, but the MAPPING is this app's: the kit's pill
// colours say on-track / at-risk / late, and this is an eight-stage
// approval chain, so the forward stages climb the green family by
// intensity and brown/terracotta stay for the two exceptions. See the
// comment above --app-status-* for the contrast figures.
const COLORS: Record<ExpenseRequest["status"], { background: string; color: string; border?: string }> = {
  SUBMITTED: { background: "var(--app-status-submitted-bg)", color: "var(--app-status-submitted-fg)", border: "var(--app-status-submitted-edge)" },
  PO_UPLOADED: { background: "var(--app-status-po-bg)", color: "var(--app-status-po-fg)", border: "var(--app-status-po-edge)" },
  BO_APPROVED: { background: "var(--app-status-bo-bg)", color: "var(--app-status-bo-fg)", border: "var(--app-status-bo-edge)" },
  CEO_APPROVED: { background: "var(--app-status-ceo-bg)", color: "var(--app-status-ceo-fg)" },
  PAID: { background: "var(--app-status-paid-bg)", color: "var(--app-status-paid-fg)" },
  REJECTED: { background: "var(--app-status-rejected-bg)", color: "var(--app-status-rejected-fg)", border: "var(--app-status-rejected-edge)" },
  EDIT_REQUESTED: { background: "var(--app-status-edit-bg)", color: "var(--app-status-edit-fg)", border: "var(--app-status-edit-edge)" },
  // Historical only (imported legacy rows). Nothing produces this status
  // going forward. See lib/constants.ts#STATUSES.
  EXPIRED: { background: "var(--app-status-expired-bg)", color: "var(--app-status-expired-fg)", border: "var(--app-status-expired-edge)" },
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
