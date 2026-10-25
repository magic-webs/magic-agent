"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { InstagramPost } from "@/convex/instagramAutomation";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Image01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

type Picked = { id: string; caption?: string; thumbnailUrl?: string; permalink?: string };

export function PostPicker({
  channelId,
  value,
  onChange,
  max,
}: {
  channelId: Id<"channels">;
  value: Picked[];
  onChange: (posts: Picked[]) => void;
  max: number;
}) {
  const listMedia = useAction(api.instagramAutomation.listMedia);
  const [posts, setPosts] = useState<InstagramPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    listMedia({ channelId })
      .then((rows) => live && setPosts(rows))
      .catch((caught) => live && setError(friendlyError(caught)));
    return () => {
      live = false;
    };
  }, [channelId, listMedia, attempt]);

  const chosen = new Set(value.map((post) => post.id));
  const toggle = (post: InstagramPost) => {
    if (chosen.has(post.id)) {
      onChange(value.filter((row) => row.id !== post.id));
    } else if (value.length < max) {
      onChange([
        ...value,
        {
          id: post.id,
          caption: post.caption,
          thumbnailUrl: post.thumbnailUrl,
          permalink: post.permalink,
        },
      ]);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        {error}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!posts) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Loading posts…
      </p>
    );
  }
  if (posts.length === 0) {
    return <p className="text-xs text-muted-foreground">This account has no posts yet.</p>;
  }

  return (
    <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
      {posts.map((post) => {
        const on = chosen.has(post.id);
        return (
          <button
            key={post.id}
            type="button"
            title={post.caption || "Post"}
            onClick={() => toggle(post)}
            className={cn(
              "relative aspect-square overflow-hidden rounded-md border bg-muted",
              on ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"
            )}
          >
            {post.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                {post.mediaType === "VIDEO" ? <HugeiconsIcon icon={Video01Icon} strokeWidth={2} /> : <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />}
              </span>
            )}
            {on ? (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2}
                className="absolute top-1 right-1 size-5 rounded-full bg-background text-primary" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
