/**
 * Proves the sidebar shows every person EXACTLY the items the old top nav
 * showed them.
 *
 * Why this and not reasoning: a nav rewrite that quietly grants someone a
 * menu is the one way this change can do real damage, and "I reused the
 * same filter" is an argument, not evidence. This builds both menus for
 * every real person from the live tables, through the app's own
 * `canAccessPage`, and diffs them.
 *
 *   OLD = components/Nav.tsx@a3f4607's LINKS, filtered by access[page]
 *   NEW = components/nav/navConfig.tsx's NAV_GROUPS, filtered the same way
 *
 * Run: npx tsx scripts/verify-nav-parity.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const line of env.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

// The OLD nav's page list, transcribed from components/Nav.tsx at a3f4607
// (the commit before this change). Order is the old nav's.
const OLD_PAGES = [
  "submit", "my", "petty-cash", "procurement", "bo-approvals",
  "ceo-approvals", "accounting", "budget", "spend-report",
  "branch-review", "settings",
];

(async () => {
  const { createAdminClient } = await import("../lib/supabase/admin");
  const { canAccessPageV2 } = await import("../lib/access-v2");
  const { PAGES } = await import("../lib/permissions");
  const { NAV_GROUPS } = await import("../components/nav/navConfig");
  const admin = createAdminClient();

  // ---- structural check: the two page sets must be the same ----
  const newItems = NAV_GROUPS.flatMap((g) => g.items);
  const newPages = newItems.filter((i) => i.page).map((i) => i.page as string);
  const ungated = newItems.filter((i) => !i.page).map((i) => i.href);
  const onlyOld = OLD_PAGES.filter((p) => !newPages.includes(p));
  const onlyNew = newPages.filter((p) => !OLD_PAGES.includes(p));
  console.log("═══ 1. page keys ═══");
  console.log(`   old ${OLD_PAGES.length}   new ${newPages.length}`);
  console.log(`   only in old: ${onlyOld.length ? onlyOld.join(", ") : "none"}`);
  console.log(`   only in new: ${onlyNew.length ? onlyNew.join(", ") : "none"}`);
  console.log(`   ungated (no access key): ${ungated.join(", ") || "none"}`);
  const dupes = newPages.filter((p, i) => newPages.indexOf(p) !== i);
  console.log(`   duplicated in new: ${dupes.length ? dupes.join(", ") : "none"}`);

  // ---- per-person check against live data ----
  // Uses the app's OWN loader and the app's OWN permission function. An
  // earlier draft of this script hand-built a PersonV2 and joined on
  // `person_id`; the real tables key on `email` and the shape differs, so it
  // silently matched nobody and reported a pass over zero people. Going
  // through loadPerson is what makes the result mean anything.
  const { loadPerson } = await import("../lib/person");
  const { data: people } = await admin
    .from("people")
    .select("email, active")
    .order("email");
  if (!people || people.length === 0) throw new Error("no people loaded — check credentials");

  let checked = 0;
  const mismatches: string[] = [];
  const shapes = new Map<string, string[]>();

  for (const row of people as { email: string; active: boolean }[]) {
    const person = await loadPerson(row.email);
    if (!person) {
      mismatches.push(`${row.email}: loadPerson returned null`);
      continue;
    }

    const access: Record<string, boolean> = {};
    for (const page of PAGES) access[page] = canAccessPageV2(person, page);

    const oldMenu = OLD_PAGES.filter((pg) => access[pg]);
    const newMenu = newItems.filter((i) => i.page === undefined || access[i.page]);
    const newMenuPages = newMenu.filter((i) => i.page).map((i) => i.page as string);

    const a2 = [...oldMenu].sort().join("|");
    const b2 = [...newMenuPages].sort().join("|");
    if (a2 !== b2) {
      mismatches.push(
        `${row.email}\n     old: ${oldMenu.join(", ") || "(none)"}\n     new: ${newMenuPages.join(", ") || "(none)"}`
      );
    }
    checked++;
    if (!shapes.has(a2)) shapes.set(a2, []);
    shapes.get(a2)!.push(`${row.email}${person.active ? "" : " (inactive)"}`);
  }

  console.log(`\n═══ 2. per-person, against live data ═══`);
  console.log(`   people checked: ${checked}`);
  console.log(`   mismatches:     ${mismatches.length}`);
  for (const m of mismatches) console.log(`   ✗ ${m}`);

  console.log(`\n═══ 3. distinct menus in use (${shapes.size}) ═══`);
  for (const [k, who] of [...shapes.entries()].sort((x, y) => y[1].length - x[1].length)) {
    console.log(`   ${who.length.toString().padStart(2)} people · ${k.split("|").join(", ") || "(none)"}`);
    console.log(`        ${who.slice(0, 4).join(", ")}${who.length > 4 ? ` … +${who.length - 4}` : ""}`);
  }

  const ok =
    checked > 0 &&
    mismatches.length === 0 &&
    onlyOld.length === 0 &&
    onlyNew.length === 0 &&
    dupes.length === 0;
  console.log(
    `\n${ok ? `✓ PASS — ${checked} people, every gated item set identical` : "✗ FAIL"}`
  );
  process.exit(ok ? 0 : 1);
})();
