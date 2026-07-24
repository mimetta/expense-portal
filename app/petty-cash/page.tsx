import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import PettyCashClient from "./pettycashClient";

export default async function PettyCashPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "petty-cash")) redirect("/");
  return <PettyCashClient />;
}
