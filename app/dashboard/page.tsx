import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import DashboardClient from "./dashboardClient";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "dashboard")) redirect("/");
  return <DashboardClient />;
}
