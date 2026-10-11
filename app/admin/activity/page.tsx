"use client";

import { Suspense } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACTIVITY_ENTITIES } from "@/convex/lib/activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelectField } from "@/components/select-field";
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
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
};

const VERB_TONE: Record<string, "secondary" | "outline" | "destructive"> = {
  insert: "secondary",
  update: "outline",
  delete: "destructive",
};

const ALL = "all";

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
    if (value && value !== ALL) next.set(key, value);
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
        <SelectField
          aria-label="Workspace"
          className="min-w-48"
          value={workspaceId || ALL}
          onValueChange={(value) => setFilter("workspace", value)}
          options={[
            { value: ALL, label: "All workspaces" },
            ...(workspaces ?? []).map((workspace) => ({
              value: workspace._id,
              label: workspace.name,
            })),
          ]}
        />
        <SelectField
          aria-label="Person"
          className="min-w-44"
          value={actorId || ALL}
          onValueChange={(value) => setFilter("actor", value)}
          options={[
            { value: ALL, label: "Everyone" },
            ...(actors ?? []).map((actor) => ({
              value: actor.actorId,
              label: `${actor.actorLabel} · ${ROLE_LABEL[actor.actorRole] ?? actor.actorRole}`,
            })),
          ]}
        />
        <SelectField
          aria-label="Type"
          className="min-w-44"
          value={entity || ALL}
          onValueChange={(value) => setFilter("type", value)}
          options={[
            { value: ALL, label: "Everything" },
            ...ACTIVITY_ENTITIES.map((name) => ({ value: name, label: name })),
          ]}
        />
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
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-28">When</TableHead>
                <TableHead className="min-w-44">Who</TableHead>
                <TableHead className="min-w-24">Action</TableHead>
                <TableHead className="min-w-48">Item</TableHead>
                <TableHead className="hidden md:table-cell min-w-48">Changed</TableHead>
                {workspaceId ? null : (
                  <TableHead className="hidden lg:table-cell min-w-36">Workspace</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row) => (
                <TableRow key={row._id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {when(row._creationTime)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium">{row.actorLabel}</span>
                      <Badge variant="secondary" className="w-fit">
                        {ROLE_LABEL[row.actorRole] ?? row.actorRole}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={VERB_TONE[row.operation]}>{VERB[row.operation]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs text-muted-foreground">{row.entity}</span>
                      <span className="truncate">{row.name ?? "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-72 text-xs text-muted-foreground">
                    <span className="line-clamp-2 whitespace-normal">
                      {row.fields?.length ? row.fields.join(", ") : "—"}
                    </span>
                  </TableCell>
                  {workspaceId ? null : (
                    <TableCell className="hidden lg:table-cell">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        onClick={() => setFilter("workspace", row.workspaceId)}
                      >
                        {row.workspaceName}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
