"use client";

import { useCallback, useEffect, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

type BillingSummary = FunctionReturnType<typeof api.billing.workspaceSummary>;

const REFRESH_MS = 10 * 60 * 1000;
const cache = new Map<string, { data: BillingSummary; at: number }>();

/**
 * billing.workspaceSummary read on a timer instead of subscribed: every
 * message writes billingEvents, so a live subscription re-read the window per
 * message.
 */
export function useBillingSummary(workspaceId: Id<"workspaces">, days: number) {
  const convex = useConvex();
  const key = `${workspaceId}:${days}`;
  const [, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await convex.query(api.billing.workspaceSummary, {
        workspaceId,
        days,
        now: Date.now(),
      });
      cache.set(key, { data, at: Date.now() });
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err);
    }
  }, [convex, workspaceId, days, key]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible" || !cache.has(key)) {
        await load();
      }
      if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
    };
    const age = Date.now() - (cache.get(key)?.at ?? 0);
    timer = setTimeout(tick, Math.max(0, REFRESH_MS - age));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  if (error) throw error;
  const entry = cache.get(key);
  return {
    data: entry?.data,
    fetchedAt: entry?.at,
    refresh,
    refreshing,
  };
}
