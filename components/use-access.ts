"use client";

import { useCallback } from "react";
import { useSession } from "@/components/use-session";
import { AREAS, FULL_ACCESS, type Access, type WorkspaceArea } from "@/convex/lib/access";

/**
 * What the signed-in person may see and change in the workspace. Everyone but
 * a human agent with a role has it all. The server enforces the same rules;
 * this only keeps the screen from offering what would be refused.
 */
export function useAccess() {
  const { me } = useSession();
  const access: Access = me?.role === "member" ? me.access : FULL_ACCESS;
  const canView = useCallback(
    (area: WorkspaceArea) => access.areas[area] !== "none",
    [access]
  );
  const canEdit = useCallback(
    (area: WorkspaceArea) => access.areas[area] === "edit",
    [access]
  );
  return {
    access,
    loading: me === undefined,
    /** The owner's account, the company login or the platform team: roles are theirs to manage. */
    isOwner: Boolean(me) && me?.role !== "member",
    canView,
    canEdit,
    /** Where to land when the dashboard itself is hidden. */
    firstArea: AREAS.find((area) => access.areas[area] !== "none") ?? null,
  };
}

const BUILD = ["agent-config", "agents", "channels", "company", "knowledge", "products", "tools"];
const LEADS = ["leads", "contacts", "orders", "payments"];

/** The area a page under /w/<slug> belongs to, or null for pages every login keeps. */
export function areaOfPath(rest: string): WorkspaceArea | null {
  const [first = "", second] = rest.replace(/^\/+/, "").split("/");
  if (first === "") return "dashboard";
  if (first === "records") return second ? "leads" : "build";
  if (BUILD.includes(first)) return "build";
  if (LEADS.includes(first)) return "leads";
  if (first === "conversations") return "inbox";
  if (
    first === "genie" ||
    first === "team" ||
    first === "marketing" ||
    first === "social" ||
    first === "notifications" ||
    first === "integrations"
  ) {
    return first;
  }
  return null;
}

/** The page each area opens on, for landing somewhere a role allows. */
export const AREA_HOME: Record<WorkspaceArea, string> = {
  dashboard: "",
  genie: "/genie",
  team: "/team",
  build: "/agents",
  inbox: "/conversations",
  leads: "/leads",
  marketing: "/marketing",
  social: "/social",
  notifications: "/notifications",
  integrations: "/integrations",
};
