import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { getEditorData, canOpenRevisionDetail } from "@/lib/budget-editor";
import ReviewClient from "./reviewClient";

// CEO review of a submitted revision. SUPERADMIN too; the owner may open
// their own read-only. ACCOUNTING gets history rows, not cell figures.
export default async function BudgetReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  let data;
  try {
    data = await getEditorData(id, user);
  } catch {
    notFound();
  }
  if (!data.revision) notFound();
  if (!canOpenRevisionDetail(user, data.revision)) redirect("/budget/history");

  return (
    <ReviewClient
      data={JSON.parse(JSON.stringify(data))}
      viewerEmail={user.email}
      canAct={isSuperadmin(user) || hasRole(user, "CEO")}
      // Migration 030: only a SUPERADMIN may approve what they submitted.
      canSelfApprove={isSuperadmin(user)}
    />
  );
}
