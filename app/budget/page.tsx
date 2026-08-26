import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import BudgetClient from "./budgetClient";

export default async function BudgetPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "budget")) redirect("/");
  return <BudgetClient />;
}
