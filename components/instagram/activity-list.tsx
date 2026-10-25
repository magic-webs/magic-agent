"use client";

import { usePaginatedQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { ACTION_LABEL } from "@/components/instagram/context";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";

export function ActivityList({ pageSize, paged }: { pageSize: number; paged: boolean }) {
  const workspace = useWorkspace();
  const { results, status, loadMore } = usePaginatedQuery(
    api.instagramAutomation.listActivity,
    { workspaceId: workspace._id },
    { initialNumItems: pageSize }
  );

  if (status === "LoadingFirstPage") return <TableSkeleton rows={4} columns={3} />;

  if (results.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>Nothing yet</EmptyTitle>
          <EmptyDescription>
            Comments and story mentions show here as they arrive, with what was done
            about each.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {results.map((row) => (
          <li key={row._id} className="flex flex-col gap-1.5 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {row.fromUsername ? `@${row.fromUsername}` : "Someone"}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.kind === "story_mention" ? "story mention" : "comment"} ·{" "}
                {formatDistanceToNow(row.createdAt, { addSuffix: true })}
              </span>
              <span className="ml-auto flex flex-wrap gap-1">
                {row.actions.map((action) => (
                  <Badge
                    key={action}
                    variant={action === "hidden" || action === "deleted" ? "outline" : "secondary"}
                  >
                    {ACTION_LABEL[action]}
                  </Badge>
                ))}
                {row.error ? <Badge variant="destructive">Failed</Badge> : null}
              </span>
            </div>
            {row.kind === "comment" ? (
              <p className="line-clamp-3 break-words">{row.text}</p>
            ) : null}
            {row.publicReply ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Reply:</span> {row.publicReply}
              </p>
            ) : null}
            {row.dmText ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">DM:</span> {row.dmText}
              </p>
            ) : null}
            {row.ruleName || row.reason || row.error ? (
              <p className="text-xs text-muted-foreground">
                {[row.ruleName ? `Rule: ${row.ruleName}` : null, row.reason, row.error]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {paged && status !== "Exhausted" ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(pageSize)}
        >
          {status === "LoadingMore" ? <Spinner /> : null} Load more
        </Button>
      ) : null}
    </div>
  );
}
