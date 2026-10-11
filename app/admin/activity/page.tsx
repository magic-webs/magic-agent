"use client";

import { Suspense } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACTIVITY_ENTITIES } from "@/convex/lib/activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { TableSkeleton } from "@/components/skeletons";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  workspace: "Workspace owner",
  member: "Team member",
  user: "User",
};

const VERB: Record<string, string> = {
  insert: "created",
  update: "updated",
  delete: "deleted",
};

function when(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ActivityLog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspaceId = (params.get("workspace") ?? "") as Id<"workspaces"> | "";
  const actorId = params.get("actor") ?? "";
  const entity = params.get("type") ?? "";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "workspace") next.delete("actor");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  const workspaces = useQuery(api.workspaces.list, {});
  const actors = useQuery(api.activity.actors, {
    workspaceId: workspaceId || undefined,
  });
  const { results, status, loadMore } = usePaginatedQuery(
    api.activity.list,
    {
      workspaceId: workspaceId || undefined,
      actorId: actorId || undefined,
      entity: entity || undefined,
    },
    { initialNumItems: 50 }
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Activity
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change people made to a workspace, kept for 90 days.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={workspaceId}
          onChange={(event) => setFilter("workspace", event.target.value)}
          aria-label="Workspace"
          className="min-w-48"
        >
          <NativeSelectOption value="">All workspaces</NativeSelectOption>
          {(workspaces ?? []).map((workspace) => (
            <NativeSelectOption key={workspace._id} value={workspace._id}>
              {workspace.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={actorId}
          onChange={(event) => setFilter("actor", event.target.value)}
          aria-label="Person"
          className="min-w-44"
        >
          <NativeSelectOption value="">Everyone</NativeSelectOption>
          {(actors ?? []).map((actor) => (
            <NativeSelectOption key={actor.actorId} value={actor.actorId}>
              {actor.actorLabel} · {ROLE_LABEL[actor.actorRole] ?? actor.actorRole}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={entity}
          onChange={(event) => setFilter("type", event.target.value)}
          aria-label="Type"
          className="min-w-44"
        >
          <NativeSelectOption value="">Everything</NativeSelectOption>
          {ACTIVITY_ENTITIES.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {status === "LoadingFirstPage" ? (
        <TableSkeleton rows={8} />
      ) : results.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No activity</EmptyTitle>
            <EmptyDescription>
              Nothing matches these filters in the last 90 days.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="shrink-0">
          <CardContent>
            {results.map((row, index) => (
              <div key={row._id}>
                {index > 0 ? <Separator /> : null}
                <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{row.actorLabel}</span>{" "}
                      <Badge variant="secondary" className="align-middle">
                        {ROLE_LABEL[row.actorRole] ?? row.actorRole}
                      </Badge>{" "}
                      {VERB[row.operation]} {row.entity.toLowerCase()}
                      {row.name ? (
                        <>
                          {" "}
                          <span className="font-medium">“{row.name}”</span>
                        </>
                      ) : null}
                    </p>
                    {row.fields?.length ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Changed: {row.fields.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                    {workspaceId ? null : (
                      <button
                        type="button"
                        className="block hover:text-foreground hover:underline sm:ml-auto"
                        onClick={() => setFilter("workspace", row.workspaceId)}
                      >
                        {row.workspaceName}
                      </button>
                    )}
                    <span>{when(row._creationTime)}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(50)}
        >
          {status === "LoadingMore" ? <Spinner /> : null} Load more
        </Button>
      ) : null}
    </div>
  );
}

export default function AdminActivityPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <ActivityLog />
    </Suspense>
  );
}
