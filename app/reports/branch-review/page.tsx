import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { reviewableDepartments } from "@/lib/branch-review";
import BranchReviewClient from "./branchReviewClient";

// Thin server guard, same shape as every other gated page. Access is "owns at
// least one branch-split department", computed in one place so the page and
// the API cannot disagree — the failure that locked people out of Settings.
export default async function BranchReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const departments = await reviewableDepartments(user);
  if (departments.length === 0) redirect("/");
  return <BranchReviewClient departments={departments} />;
}
