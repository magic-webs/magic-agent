import type { Doc } from "@/convex/_generated/dataModel";
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_TYPES,
  labelOf,
  type SupportPriority,
  type SupportStatus,
  type SupportType,
} from "@/convex/lib/support";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<SupportStatus, string> = {
  open: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  waiting_client: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "bg-muted text-muted-foreground",
};

const PRIORITY_TONE: Record<SupportPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-secondary text-secondary-foreground",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  urgent: "bg-destructive/10 text-destructive",
};

export function StatusBadge({
  status,
  staff = false,
}: {
  status: SupportStatus;
  staff?: boolean;
}) {
  const label =
    staff && status === "waiting_client" ? "Waiting on client" : labelOf(SUPPORT_STATUSES, status);
  return <Badge className={cn("border-0", STATUS_TONE[status])}>{label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: SupportPriority }) {
  return (
    <Badge className={cn("border-0", PRIORITY_TONE[priority])}>
      {labelOf(SUPPORT_PRIORITIES, priority)}
    </Badge>
  );
}

export function typeLabel(type: SupportType): string {
  return labelOf(SUPPORT_TYPES, type);
}

export function statusLabel(status: SupportStatus, staff = false): string {
  return staff && status === "waiting_client"
    ? "Waiting on client"
    : labelOf(SUPPORT_STATUSES, status);
}

export function eventText(event: {
  kind: Doc<"supportEvents">["kind"];
  actorName: string;
  detail: string | null;
}): string {
  const who = event.actorName;
  const detail = event.detail;
  switch (event.kind) {
    case "created":
      return `${who} opened the ticket`;
    case "status":
      return detail?.startsWith("merged")
        ? `${who} ${detail}`
        : `${who} set the status to ${statusLabel((detail ?? "open").split(" ")[0] as SupportStatus).toLowerCase()}${detail?.includes("—") ? ` (${detail.split("— ")[1]})` : ""}`;
    case "priority":
      return `${who} set the priority to ${detail?.toLowerCase()}`;
    case "assigned":
      return detail === "Unassigned" ? `${who} unassigned the ticket` : `${who} assigned it to ${detail}`;
    case "reopened":
      return `${who} reopened the ticket`;
    case "rated":
      return `${who} rated the support ${detail}`;
    case "access_requested":
      return `${who} asked for access to the workspace`;
    case "access_declined":
      return `${who} declined the access request`;
    case "access_granted":
      return `${who} granted access for ${detail}`;
    case "access_revoked":
      return `Access was ended by ${who}`;
    case "access_expired":
      return "Access expired";
    case "workspace_opened":
      return `${who} opened the workspace${detail ? ` ${detail}` : ""}`;
    case "vault_added":
      return `${who} shared credentials: ${detail}`;
    case "vault_revealed":
      return `${who} viewed the credentials for ${detail}`;
    case "vault_wiped":
      return "Shared credentials were deleted";
    case "sla_breached":
      return `The ${detail} target was missed`;
  }
}
