import type { ReactNode } from "react";
import type { NavIconKey } from "./navConfig";

/**
 * The sidebar icons, exactly as drawn in docs/sidebar-nav-mockup.html.
 * Inline SVG because this app has no icon library and will not gain one
 * for twelve glyphs. Keyed so navConfig.ts can stay free of JSX.
 */
const s = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
} as const;

const IconHome = (
  <svg {...s} aria-hidden>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </svg>
);
const IconSubmit = (
  <svg {...s} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconMy = (
  <svg {...s} aria-hidden>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);
const IconCheck = (
  <svg {...s} aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const IconStar = (
  <svg {...s} aria-hidden>
    <path d="M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2L6.7 19l1.4-6-4.6-4 6.1-.5z" />
  </svg>
);
const IconAccounting = (
  <svg {...s} aria-hidden>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10.5h18M7 15h4" />
  </svg>
);
const IconProcurement = (
  <svg {...s} aria-hidden>
    <path d="M4 7h16l-1.4 12.2a1.5 1.5 0 0 1-1.5 1.3H6.9a1.5 1.5 0 0 1-1.5-1.3z" />
    <path d="M9 7V5.4A2.4 2.4 0 0 1 11.4 3h1.2A2.4 2.4 0 0 1 15 5.4V7" />
  </svg>
);
const IconPettyCash = (
  <svg {...s} aria-hidden>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M14.6 9.8c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.6.8-2.6 1.9 0 2.6 5.2 1.3 5.2 3.9 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2.1-.4-2.6-1.2" />
  </svg>
);
const IconBudget = (
  <svg {...s} aria-hidden>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M9 9v12M15 9v12" />
  </svg>
);
const IconSpend = (
  <svg {...s} aria-hidden>
    <path d="M4 19V9M9.3 19V4.5M14.7 19v-7M20 19v-5" />
  </svg>
);
const IconBranch = (
  <svg {...s} aria-hidden>
    <path d="M3.5 20V8.2L12 3.5l8.5 4.7V20" />
    <path d="M9.5 20v-6h5v6" />
  </svg>
);
const IconSettings = (
  <svg {...s} aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.5 12H2.1M21.9 12h-2.4M6.7 6.7 5 5M19 19l-1.7-1.7M6.7 17.3 5 19M19 5l-1.7 1.7" />
  </svg>
);


export const NAV_ICONS: Record<NavIconKey, ReactNode> = {
  home: IconHome,
  submit: IconSubmit,
  my: IconMy,
  check: IconCheck,
  star: IconStar,
  accounting: IconAccounting,
  procurement: IconProcurement,
  pettyCash: IconPettyCash,
  budget: IconBudget,
  spend: IconSpend,
  branch: IconBranch,
  settings: IconSettings,
};
