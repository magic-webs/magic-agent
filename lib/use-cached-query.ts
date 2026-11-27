"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";

/**
 * Convex's `useQuery`, live in the same way, but held in TanStack's cache for
 * `gcTime` after the last page using it closes, so coming back is instant.
 */
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const { data } = useQuery({
    ...convexQuery(query as FunctionReference<"query">, args[0] ?? {}),
    throwOnError: true,
  });
  return data as FunctionReturnType<Query> | undefined;
}
