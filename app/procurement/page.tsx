import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import ProcurementClient from "./procurementClient";

export default async function ProcurementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "procurement")) redirect("/");
  return <ProcurementClient />;
}
