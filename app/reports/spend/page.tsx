import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPage } from "@/lib/permissions";
import SpendReportClient from "./spendClient";

// Server-side guard — the nav item is filtered by /api/roles/me's access map,
// but that is UX only; this redirect and the matching check in
// GET /api/spend-report are the real boundary. Same thin
// server-component/client-component split as every other gated page.
export default async function SpendReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessPage(user, "spend-report")) redirect("/");
  // SpendFilters keeps all its state in the query string (useSearchParams),
  // which needs a Suspense boundary in the App Router — same wrapper pattern
  // app/settings/settingsClient.tsx uses for its ?tab= param.
  return (
    <Suspense fallback={null}>
      <SpendReportClient />
    </Suspense>
  );
}
