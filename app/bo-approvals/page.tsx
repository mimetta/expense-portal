import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import BoApprovalsClient from "./boapprovalsClient";

export default async function BoApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "bo-approvals")) redirect("/");
  return <BoApprovalsClient />;
}
