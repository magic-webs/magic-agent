"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  INSTAGRAM_GRADIENT,
  InstagramContext,
  fail,
} from "@/components/instagram/context";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  InstagramIcon,
} from "@hugeicons/core-free-icons";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstagramLayout({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [since] = useState(() => Date.now() - WEEK_MS);
  const overview = useQuery(api.instagramAutomation.overview, {
    workspaceId: workspace._id,
    since,
  });
  const startConnect = useAction(api.instagram.startConnect);
  const [picked, setPicked] = useState<Id<"channels"> | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const connected = params.get("connected");
  const connectError = params.get("instagram_error");
  useEffect(() => {
    if (connected !== "instagram" && !connectError) return;
    if (connectError) {
      toast.add({ title: "Instagram was not reconnected", description: connectError, type: "error" });
    } else {
      toast.add({ title: "Instagram reconnected", type: "success" });
    }
    router.replace(pathname);
  }, [connected, connectError, pathname, router]);

  if (overview === undefined) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  const channel =
    overview.channels.find((row) => row._id === picked) ?? overview.channels[0];

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={InstagramIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Connect Instagram first</EmptyTitle>
            <EmptyDescription>
              Comment replies, moderation and DM tools work on a connected Instagram
              business or creator account.
            </EmptyDescription>
          </EmptyHeader>
          <Button nativeButton={false} render={<Link href={`/w/${workspace.slug}/channels`} />}>
            Go to Channels
          </Button>
        </Empty>
      </div>
    );
  }

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const { url } = await startConnect({
        workspaceId: workspace._id,
        agentId: channel.agentId,
        name: channel.name,
        returnTo: `${window.location.origin}${pathname}`,
      });
      window.location.assign(url);
    } catch (error) {
      fail("Could not start Instagram sign-in", error);
      setReconnecting(false);
    }
  };

  return (
    <InstagramContext.Provider value={{ overview, channel, setChannelId: setPicked }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          {channel.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={channel.profilePictureUrl}
              alt=""
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <span
              className={`flex size-10 items-center justify-center rounded-full text-white ${INSTAGRAM_GRADIENT}`}
            >
              <HugeiconsIcon icon={InstagramIcon} strokeWidth={2} className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">@{channel.username}</p>
            <p className="text-xs text-muted-foreground">
              {overview.rules.live} of {overview.rules.total} comment rules live
            </p>
          </div>
          {channel.status !== "active" ? (
            <Badge variant="destructive">{channel.status === "paused" ? "Paused" : "Error"}</Badge>
          ) : null}
          {overview.channels.length > 1 ? (
            <SelectField
              size="sm"
              className="w-48"
              aria-label="Instagram account"
              value={channel._id}
              onValueChange={(value) => setPicked(value as Id<"channels">)}
              options={overview.channels.map((row) => ({
                value: row._id,
                label: `@${row.username}`,
              }))}
            />
          ) : null}
        </div>

        {!channel.canManageComments ? (
          <Alert>
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
            <AlertTitle>Reconnect to turn on comment automation</AlertTitle>
            <AlertDescription>
              <p>
                @{channel.username} was connected before comment access was added. Sign in
                again and allow comment management so replies and moderation can work.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={reconnecting}
                onClick={reconnect}
              >
                {reconnecting ? <Spinner /> : <HugeiconsIcon icon={InstagramIcon} strokeWidth={2} />} Reconnect Instagram
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {channel.status === "error" && channel.lastError ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
            <AlertTitle>Instagram needs attention</AlertTitle>
            <AlertDescription>{channel.lastError}</AlertDescription>
          </Alert>
        ) : null}

        {children}
      </div>
    </InstagramContext.Provider>
  );
}
