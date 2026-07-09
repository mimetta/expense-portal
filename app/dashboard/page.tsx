import { redirect } from "next/navigation";

// Dashboard was removed from the nav — the homepage (/) now serves as the
// dashboard (see CLAUDE.md "Homepage"). This route stays in place (rather
// than being deleted) purely so a stale bookmark/link to /dashboard doesn't
// 404; it always redirects. dashboardClient.tsx and the /api/dashboard/
// budget+revenue routes it used are left in place, unreachable but intact,
// in case the budget-vs-actual/revenue-overlay view is wanted again later —
// nothing asked for that code to be deleted, only for the page to stop
// being linked/visitable.
export default function DashboardPage() {
  redirect("/");
}
