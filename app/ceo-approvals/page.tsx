import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import CeoApprovalsClient from "./ceoapprovalsClient";

export default async function CeoApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "ceo-approvals")) redirect("/");
  return <CeoApprovalsClient />;
}
