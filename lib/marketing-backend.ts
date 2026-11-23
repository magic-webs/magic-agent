"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAction,
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { usePaginatedQuery as useHelperPaginatedQuery } from "convex-helpers/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useWorkspace } from "@/components/workspace-provider";
import { VM_FUNCTIONS } from "@/lib/marketing-functions";

const BASE_URL = (process.env.NEXT_PUBLIC_MARKETING_API_URL ?? "https://marketing-api.magicwebs.ai").replace(/\/$/, "");
const POLL_MS = 60_000;
const LIVE_URL = `${BASE_URL.replace(/^http/, "ws")}/v1/live`;
const RETRY_MAX_MS = 60_000;
const PAGE_MAX = 500;

type AnyQuery = FunctionReference<"query">;
type AnyMutation = FunctionReference<"mutation">;
type AnyAction = FunctionReference<"action">;
type PaginatedRef = FunctionReference<"query", "public", { paginationOpts: unknown }>;

let token: { value: string; until: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function accessToken(): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  pendingToken ??= (async () => {
    try {
      const res = await fetch("/api/auth/token", { cache: "no-store" });
      if (!res.ok) throw new Error("Sign in to continue.");
      const { token: value } = (await res.json()) as { token: string };
      const payload = JSON.parse(atob(value.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
      token = { value, until: (payload.exp ? payload.exp * 1000 : Date.now() + 60_000) - 30_000 };
      return value;
    } finally {
      pendingToken = null;
    }
  })();
  return pendingToken;
}

class VmError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function callVm<T>(name: string, args: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/v1/call/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify(args ?? {}),
  });
  const body = (await res.json().catch(() => null)) as { value?: T; error?: string } | null;
  if (res.status === 400 && body?.error) throw new ConvexError(body.error);
  if (res.status === 401) token = null;
  if (!res.ok) throw new VmError(body?.error ?? "Something went wrong. Please try again.", res.status);
  return body?.value as T;
}

const listeners = new Set<() => void>();

/** Refetch every marketing view: what Convex's reactivity did after a write. */
export function refreshMarketing() {
  for (const listener of listeners) listener();
}

type Live = { users: number; socket: WebSocket | null; opened: boolean; retries: number; retry?: ReturnType<typeof setTimeout> };

const lives = new Map<string, Live>();
let missed = false;

function onChanged() {
  if (document.visibilityState === "visible") refreshMarketing();
  else missed = true;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && missed) {
      missed = false;
      refreshMarketing();
    }
  });
}

function connect(workspaceId: string, live: Live) {
  const reconnect = () => {
    if (live.users === 0) return;
    const delay = Math.min(RETRY_MAX_MS, 1000 * 2 ** live.retries) * (0.5 + Math.random() / 2);
    live.retries++;
    live.retry = setTimeout(() => connect(workspaceId, live), delay);
  };
  accessToken().then(
    (value) => {
      if (live.users === 0) return;
      const socket = new WebSocket(`${LIVE_URL}?workspaceId=${encodeURIComponent(workspaceId)}&token=${encodeURIComponent(value)}`);
      live.socket = socket;
      socket.onopen = () => {
        if (live.opened) onChanged();
        live.opened = true;
        live.retries = 0;
      };
      socket.onmessage = onChanged;
      socket.onclose = () => {
        if (live.socket === socket) live.socket = null;
        reconnect();
      };
    },
    reconnect
  );
}

function useLive(workspaceId: string | null) {
  useEffect(() => {
    if (!workspaceId) return;
    let live = lives.get(workspaceId);
    if (!live) {
      live = { users: 0, socket: null, opened: false, retries: 0 };
      lives.set(workspaceId, live);
    }
    live.users++;
    if (live.users === 1) connect(workspaceId, live);
    const held = live;
    return () => {
      held.users--;
      if (held.users > 0) return;
      clearTimeout(held.retry);
      held.socket?.close();
      held.socket = null;
      lives.delete(workspaceId);
    };
  }, [workspaceId]);
}

function useOnVm(ref: FunctionReference<"query" | "mutation" | "action">) {
  const workspace = useWorkspace();
  return Boolean(workspace.marketingOnVm) && VM_FUNCTIONS.has(getFunctionName(ref));
}

const cache = new Map<string, unknown>();

function useVmQuery<T>(name: string, args: unknown | null): T | undefined {
  const key = args === null ? null : `${name}:${JSON.stringify(args)}`;
  const [state, setState] = useState<{ key: string; value?: T; error?: unknown } | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const workspace = useWorkspace();
  useLive(key === null ? null : workspace._id);

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    const run = async () => {
      try {
        const value = await callVm<T>(name, argsRef.current);
        cache.set(key, value);
        if (alive) setState({ key, value });
      } catch (error) {
        const fatal = error instanceof ConvexError || (error instanceof VmError && error.status < 500);
        if (alive && (fatal || !cache.has(key))) setState({ key, error });
      }
    };
    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    listeners.add(run);
    return () => {
      alive = false;
      clearInterval(timer);
      listeners.delete(run);
    };
  }, [key, name]);

  if (key === null) return undefined;
  if (state?.key === key && state.error) throw state.error;
  if (state?.key === key) return state.value;
  return cache.get(key) as T | undefined;
}

export function useMarketingQuery<Q extends AnyQuery>(
  ref: Q,
  args: FunctionArgs<Q> | "skip"
): FunctionReturnType<Q> | undefined {
  const onVm = useOnVm(ref);
  const fromConvex = useQuery(ref, (onVm ? "skip" : args) as FunctionArgs<Q> | "skip");
  const fromVm = useVmQuery<FunctionReturnType<Q>>(getFunctionName(ref), onVm && args !== "skip" ? args : null);
  return onVm ? fromVm : fromConvex;
}

export function useMarketingMutation<M extends AnyMutation>(ref: M) {
  const onVm = useOnVm(ref);
  const convexMutation = useMutation(ref);
  return useCallback(
    async (args: FunctionArgs<M>): Promise<FunctionReturnType<M>> => {
      if (!onVm) return convexMutation(args);
      const value = await callVm<FunctionReturnType<M>>(getFunctionName(ref), args);
      refreshMarketing();
      return value;
    },
    [onVm, convexMutation, ref]
  );
}

export function useMarketingAction<A extends AnyAction>(ref: A) {
  const onVm = useOnVm(ref);
  const convexAction = useAction(ref);
  return useCallback(
    async (args: FunctionArgs<A>): Promise<FunctionReturnType<A>> => {
      if (!onVm) return convexAction(args);
      const value = await callVm<FunctionReturnType<A>>(getFunctionName(ref), args);
      refreshMarketing();
      return value;
    },
    [onVm, convexAction, ref]
  );
}

/** For the few places that read once, imperatively, rather than subscribe. */
export function useMarketingClient() {
  const convex = useConvex();
  const workspace = useWorkspace();
  return useMemo(
    () => ({
      query: async <Q extends AnyQuery>(ref: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>> =>
        workspace.marketingOnVm && VM_FUNCTIONS.has(getFunctionName(ref))
          ? callVm<FunctionReturnType<Q>>(getFunctionName(ref), args)
          : convex.query(ref, args),
    }),
    [convex, workspace.marketingOnVm]
  );
}

type PageResult<T> = { page: T[]; isDone: boolean; continueCursor: string };
type Paginated<T> = {
  results: T[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
};
type Item<Q extends PaginatedRef> = FunctionReturnType<Q> extends PageResult<infer T> ? T : never;
type PageArgs<Q extends PaginatedRef> = Omit<FunctionArgs<Q>, "paginationOpts">;

function useVmPaginated<T>(name: string, args: unknown | null, initialNumItems: number): Paginated<T> {
  const key = args === null ? null : `${name}:${JSON.stringify(args)}`;
  const [limit, setLimit] = useState({ key, value: initialNumItems });
  const wanted = limit.key === key ? limit.value : initialNumItems;
  const [state, setState] = useState<{ key: string; wanted: number; results: T[]; isDone: boolean; error?: unknown } | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const workspace = useWorkspace();
  useLive(key === null ? null : workspace._id);

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    const run = async () => {
      try {
        const results: T[] = [];
        let cursor: string | null = null;
        let isDone = false;
        while (results.length < wanted && !isDone) {
          const page: PageResult<T> = await callVm<PageResult<T>>(name, {
            ...(argsRef.current as object),
            paginationOpts: { numItems: Math.min(PAGE_MAX, wanted - results.length), cursor },
          });
          results.push(...page.page);
          isDone = page.isDone;
          cursor = page.continueCursor;
        }
        if (alive) setState({ key, wanted, results, isDone });
      } catch (error) {
        if (alive) setState((prev) => (prev?.key === key && !(error instanceof ConvexError) ? prev : { key, wanted, results: [], isDone: true, error }));
      }
    };
    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    listeners.add(run);
    return () => {
      alive = false;
      clearInterval(timer);
      listeners.delete(run);
    };
  }, [key, name, wanted]);

  const loadMore = useCallback((numItems: number) => setLimit({ key, value: wanted + numItems }), [key, wanted]);

  if (key === null || !state || state.key !== key) {
    return { results: [], status: "LoadingFirstPage", isLoading: true, loadMore };
  }
  if (state.error) throw state.error;
  const loadingMore = state.wanted < wanted;
  return {
    results: state.results,
    status: loadingMore ? "LoadingMore" : state.isDone ? "Exhausted" : "CanLoadMore",
    isLoading: loadingMore,
    loadMore,
  };
}

export function useMarketingPaginatedQuery<Q extends PaginatedRef>(
  ref: Q,
  args: PageArgs<Q> | "skip",
  options: { initialNumItems: number }
): Paginated<Item<Q>> {
  const onVm = useOnVm(ref);
  const fromConvex = usePaginatedQuery(ref as never, (onVm ? "skip" : args) as never, options) as unknown as Paginated<Item<Q>>;
  const fromVm = useVmPaginated<Item<Q>>(getFunctionName(ref), onVm && args !== "skip" ? args : null, options.initialNumItems);
  return onVm ? fromVm : fromConvex;
}

/** convex-helpers' paginated hook (keeps loaded pages stable) for Convex, the same VM pager otherwise. */
export function useMarketingHelperPaginatedQuery<Q extends PaginatedRef>(
  ref: Q,
  args: PageArgs<Q> | "skip",
  options: { initialNumItems: number }
): Paginated<Item<Q>> {
  const onVm = useOnVm(ref);
  const fromConvex = useHelperPaginatedQuery(ref as never, (onVm ? "skip" : args) as never, options) as unknown as Paginated<Item<Q>>;
  const fromVm = useVmPaginated<Item<Q>>(getFunctionName(ref), onVm && args !== "skip" ? args : null, options.initialNumItems);
  return onVm ? fromVm : fromConvex;
}
