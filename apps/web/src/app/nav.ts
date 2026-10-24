import {
  Bot,
  Building2,
  CircleCheck,
  Contact,
  Flag,
  LayoutGrid,
  ListChecks,
  Plug,
  Route,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { can, type Actor } from "@kept/shared";

/**
 * Owners (and platform admins) manage people across the org. Managers and members work inside
 * one team, so they get a single "My team" page instead of the org-wide people pages.
 */
const orgWide = (a: Actor) => a.isPlatformAdmin || a.role === "owner";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  visible?: (actor: Actor) => boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { to: "overview", label: "Overview", icon: LayoutGrid },
      { to: "companies", label: "Companies", icon: Building2 },
      { to: "contacts", label: "Contacts", icon: Contact },
      { to: "commitments", label: "Commitments", icon: ListChecks },
      { to: "flags", label: "Flags", icon: Flag },
      { to: "approvals", label: "Approvals", icon: CircleCheck },
      { to: "assistant", label: "Assistant", icon: Bot },
    ],
  },
  {
    label: "People",
    items: [
      { to: "team", label: "My team", icon: UsersRound, visible: (a) => !orgWide(a) },
      { to: "members", label: "Members", icon: Users, visible: orgWide },
      { to: "teams", label: "Teams", icon: UsersRound, visible: orgWide },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "integrations", label: "Integrations", icon: Plug },
      { to: "routing", label: "Routing", icon: Route, visible: (a) => can(a, { action: "org.manage" }) },
      { to: "settings", label: "Organization", icon: Settings, visible: (a) => can(a, { action: "org.manage" }) },
    ],
  },
];
