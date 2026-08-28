import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage, hasRole, isSuperadmin } from "@/lib/permissions";
import {
  viewerHasBudgetScope,
  listBudgetOwnerOptions,
  listAdminContacts,
} from "@/lib/budget-editor";
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

  // A SUPERADMIN typically holds no BO row of their own, so "you are not a
  // budget owner" is the wrong answer for them — they pick an owner instead
  // and act on that owner's behalf.
  const isAdmin = isSuperadmin(user);
  const [owners, adminContacts] = await Promise.all([
    isAdmin ? listBudgetOwnerOptions() : Promise.resolve([]),
    isAdmin || hasScope ? Promise.resolve([]) : listAdminContacts(),
  ]);

  return (
    <BudgetEditorClient
      fiscalYear={new Date().getFullYear()}
      viewerEmail={user.email}
      isOwner={isOwner}
      hasScope={hasScope}
      isAdmin={isAdmin}
      owners={owners}
      adminContacts={adminContacts}
      canReview={isAdmin || hasRole(user, "CEO")}
    />
  );
}
