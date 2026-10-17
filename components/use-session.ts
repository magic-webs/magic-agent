"use client";

import { useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { markSigningOut } from "@/components/session-end";

/**
 * The signed-in principal, straight from Convex so it reflects revocation
 * immediately. `undefined` while loading, `null` when signed out.
 */
export function useSession() {
  const me = useQuery(api.authDb.me);

  const signOut = useCallback(async () => {
    markSigningOut();
    await fetch("/api/auth/logout", { method: "POST" });
    // A full document navigation is deliberate here: it tears down the Convex
    // client and every cached query result, so no signed-in state can linger
    // after sign-out. router.push() would keep them alive.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }, []);

  const scopes = me?.role === "admin" ? me.scopes : undefined;
  const isAdmin = me?.role === "admin" && scopes === null;
  const can = useCallback(
    (scope: AdminScope) => isAdmin || Boolean(scopes?.includes(scope)),
    [isAdmin, scopes]
  );

  return {
    me,
    isLoading: me === undefined,
    /** A full administrator: every area and every workspace. */
    isAdmin,
    isStaff: me?.role === "admin",
    /** Whether the platform role opens this admin area. */
    can,
    signOut,
  };
}

export type AdminScope = Doc<"adminRoles">["scopes"][number];
