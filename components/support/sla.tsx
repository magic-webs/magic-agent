import { formatDistanceStrict } from "date-fns";
import { ACTIVE_STATUSES, type SupportStatus } from "@/convex/lib/support";
import { cn } from "@/lib/utils";

export function SlaLabel({
  ticket,
  now,
}: {
  ticket: {
    status: SupportStatus;
    firstResponseAt: number | null;
    firstResponseDueAt: number | null;
    resolutionDueAt: number | null;
    slaBreached: boolean;
  };
  now: number;
}) {
  if (!ACTIVE_STATUSES.includes(ticket.status) || ticket.status === "waiting_client") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const responding = !ticket.firstResponseAt;
  const due = responding ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  if (!due) return <span className="text-xs text-muted-foreground">—</span>;
  const left = due - now;
  const late = left < 0;
  const soon = !late && left < 2 * 60 * 60 * 1000;
  return (
    <span
      className={cn(
        "text-xs whitespace-nowrap tabular-nums",
        late || ticket.slaBreached
          ? "font-medium text-destructive"
          : soon
            ? "font-medium text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
      )}
    >
      {responding ? "Reply" : "Resolve"} {late ? `overdue ${formatDistanceStrict(due, now)}` : `in ${formatDistanceStrict(due, now)}`}
    </span>
  );
}
