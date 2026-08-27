import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage, hasRole, isSuperadmin } from "@/lib/permissions";
import { viewerHasBudgetScope } from "@/lib/budget-editor";
import BudgetEditorClient from "./budgetClient";

// The BO's own draft editor for the current fiscal year.
//
// NOTE this path previously held the parked ONEST Cash Flow P&L. That code is
// untracked and now lives in parked/onest-pl/ (see its README) so this route
// could take /budget as specified; it was never committed and still isn't.
export default async function BudgetPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "budget")) redirect("/");

  // A BO with no scope gets a clear empty state, not an error.
  const isOwner = hasRole(user, "BO");
  const hasScope = isOwner ? await viewerHasBudgetScope(user) : false;

  return (
    <BudgetEditorClient
      fiscalYear={new Date().getFullYear()}
      viewerEmail={user.email}
      isOwner={isOwner}
      hasScope={hasScope}
      canReview={isSuperadmin(user) || hasRole(user, "CEO")}
    />
  );
}
