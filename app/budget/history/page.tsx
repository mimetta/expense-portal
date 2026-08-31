import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage, hasRole, isSuperadmin } from "@/lib/permissions";
import { listHistory } from "@/lib/budget-editor";
import { listBudgetOwners } from "@/lib/budget-revisions";
import HistoryClient from "./historyClient";

export default async function BudgetHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "budget")) redirect("/");

  const [rows, owners] = await Promise.all([listHistory(user), listBudgetOwners()]);
  return (
    <HistoryClient
      rows={JSON.parse(JSON.stringify(rows))}
      owners={owners}
      viewerEmail={user.email}
      // ACCOUNTING sees summary rows and the export, not the cell grid.
      canOpenDetail={isSuperadmin(user) || hasRole(user, "CEO") || hasRole(user, "BO")}
      canApprove={isSuperadmin(user) || hasRole(user, "CEO")}
    />
  );
}
