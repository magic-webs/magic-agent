"use client";

import { useCallback, useEffect, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type AdminSummary = FunctionReturnType<typeof api.usage.adminSummary>;

const REFRESH_MS = 10 * 60 * 1000;
const cache = new Map<number, { data: AdminSummary; at: number }>();

/**
 * usage.adminSummary read on a timer instead of subscribed: every model call
 * writes usageDaily, so a live subscription re-read the whole window per call.
 */
export function useAdminSummary(days: number) {
  const convex = useConvex();
  const [, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await convex.query(api.usage.adminSummary, {
        days,
        now: Date.now(),
      });
      cache.set(days, { data, at: Date.now() });
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err);
    }
  }, [convex, days]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible" || !cache.has(days)) {
        await load();
      }
      if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
    };
    const age = Date.now() - (cache.get(days)?.at ?? 0);
    timer = setTimeout(tick, Math.max(0, REFRESH_MS - age));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [days, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  if (error) throw error;
  const entry = cache.get(days);
  return {
    data: entry?.data,
    fetchedAt: entry?.at,
    refresh,
    refreshing,
  };
}
