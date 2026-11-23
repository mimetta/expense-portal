# What makes an app a Kindfolks module

Tick every line before the app goes in the Kindfolks menu.

## Name, look and icon
- [ ] Browser tab title **"Kindfolks · \<Module\>"** (`metadata.title`).
- [ ] On screen, top left, the lockup **"kindfolks / \<Module\>"**: the wordmark, a slash, the module
      name (`wordmark/README.md`).
- [ ] The ripple icon as favicon and apple-touch-icon (`icons/`), **loadable without a session**:
      exclude the icon paths from the sign-in redirect (middleware matcher or public-path list).
- [ ] **No web manifest.** Only Kindfolks installs as an app; a module adds no `manifest.json` /
      `manifest.ts` and no `metadata.manifest`.
- [ ] Colours, fonts and type from the kit, following `BRAND.md`; the rules file
      `claude/kindfolks-ui.md` copied into `.claude/rules/`.

## The module menu
- [ ] The menu lists **Projects · OKRs & KPIs · Dashboard · Expenses**, each link
      `<app url>/?via=switcher` (OKRs: `<Kindfolks url>/okrs?via=switcher`). The addresses live in
      Kindfolks `src/lib/apps.js` and the Dashboard's `lib/otherApps.ts`; copy them from there.
- [ ] This app's own entry is ticked and links to its own home, without `via`.

## Sign-in and access
- [ ] Google sign-in, **mimetta.co accounts only**.
- [ ] A signed-out visitor arriving with `?via=switcher` goes **straight to Google** (no sign-in page
      in between) and comes back to the page they asked for.
- [ ] Pages limited by role inside the app.
- [ ] To be hidden from people who can't open it, the app answers Kindfolks' access check:
      - `POST /api/access/can-open`
      - header `Authorization: Bearer <KINDFOLKS_ACCESS_SECRET>` (constant-time compare; wrong or
        missing → 401, secret unset → 503, never a silent pass)
      - body `{ "email": "…" }`
      - reply `200 { "<module key>": true | false }` and nothing else
      - the path is let through the sign-in middleware
      - the answer comes from the same function the sign-in uses, so menu and sign-in agree.
      Reference: the Dashboard's `app/api/access/can-open/route.ts` and `lib/accessCheck.ts`.

## Code, deploys, data
- [ ] Code on GitHub under **mimetta**.
- [ ] Deployed by **Vercel from Git**: a merge to `main` deploys production; nobody deploys by hand.
- [ ] Data on **Supabase**.

## The kit
- [ ] The kit copied in at a pinned version, recorded in the app: `brand/KIT_VERSION`.
- [ ] Updating the look later means copying the new kit version in (README › Updating), not editing
      the copied files.
