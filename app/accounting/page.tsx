import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import AccountingClient from "./accountingClient";

export default async function AccountingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "accounting")) redirect("/");
  return <AccountingClient />;
}
