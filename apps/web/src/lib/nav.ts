import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Layers,
  LayoutGrid,
  Search,
  Settings,
} from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/courses"
    | "/review"
    | "/homework"
    | "/search"
    | "/reminders"
    | "/settings"
    | "/gallery";
  label: string;
  icon: LucideIcon;
  /** Shown in the 5-tab bottom bar on phones. */
  mobileTab?: boolean;
  /** Extra words the command palette matches on. */
  keywords?: string[];
};

export const primaryNav: NavItem[] = [
  {
    to: "/",
    label: "Today",
    icon: CalendarCheck,
    mobileTab: true,
    keywords: ["home", "due", "dashboard"],
  },
  {
    to: "/courses",
    label: "Courses",
    icon: BookOpen,
    mobileTab: true,
    keywords: ["classes", "files", "modules"],
  },
  {
    to: "/homework",
    label: "Homework",
    icon: ClipboardList,
    mobileTab: true,
    keywords: ["assignments", "plan"],
  },
  {
    to: "/review",
    label: "Review",
    icon: Layers,
    keywords: ["flashcards", "study", "spaced repetition", "cards"],
  },
  { to: "/search", label: "Search", icon: Search, mobileTab: true, keywords: ["find", "ask"] },
  {
    to: "/reminders",
    label: "Reminders",
    icon: BellRing,
    keywords: ["notifications", "digest", "email"],
  },
];

export const secondaryNav: NavItem[] = [
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    mobileTab: true,
    keywords: ["account", "canvas", "profile"],
  },
  {
    to: "/gallery",
    label: "Component gallery",
    icon: LayoutGrid,
    keywords: ["design", "ui", "components"],
  },
];

export const allNav = [...primaryNav, ...secondaryNav];
export const mobileTabs = allNav.filter((i) => i.mobileTab);

/** "/courses/abc" is inside "/courses"; "/" only matches itself. */
export function isActivePath(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}
