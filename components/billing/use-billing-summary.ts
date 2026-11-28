"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/use-cached-query";
import { useHourBucket } from "@/components/use-now";

export function useBillingSummary(workspaceId: Id<"workspaces">, days: number) {
  const now = useHourBucket();
  return useCachedQuery(api.billing.workspaceSummary, { workspaceId, days, now });
}
