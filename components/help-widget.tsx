"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CustomerSupportIcon,
  Delete02Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; text: string; failed?: boolean };

const COMPOSER_ROUTES = [/\/conversations/, /\/agents\/[^/]+\/test/, /\/support\/[^/]+$/];

function Formatted({ text }: { text: string }) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-background/60 px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part.replace(/^#{1,6} /gm, "").replace(/^\* /gm, "• ").replace(/^- /gm, "• ");
  });
}

export function HelpWidget({
  workspaceId,
  supportHref,
}: {
  workspaceId: Id<"workspaces">;
  supportHref: string;
}) {
  const ask = useAction(api.help.ask);
  const pathname = usePathname();
  const hideLauncher = COMPOSER_ROUTES.some((r) => r.test(pathname));
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = useQuery(
    api.helpDb.suggestions,
    open && turns.length === 0 ? { workspaceId } : "skip"
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    const next: Turn[] = [...turns, { role: "user", text: question }];
    setTurns(next);
    setDraft("");
    setPending(true);
    try {
      const { answer } = await ask({
        workspaceId,
        page: pathname.replace(/^\/w\/[^/]+/, "") || "/ (dashboard)",
        messages: next
          .filter((t) => !t.failed)
          .map(({ role, text }) => ({ role, text })),
      });
      setTurns((t) => [...t, { role: "assistant", text: answer }]);
    } catch (error) {
      const text =
        error instanceof ConvexError && typeof error.data === "string"
          ? error.data
          : "Something went wrong. Try again, or raise a support ticket.";
      setTurns((t) => [...t, { role: "assistant", text, failed: true }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div
          role="dialog"
          aria-label="Magic Agent help"
          className="pointer-events-auto flex h-[min(560px,calc(100svh-6rem))] w-[min(380px,calc(100vw-2rem))] origin-bottom-right animate-in fade-in zoom-in-95 flex-col overflow-hidden rounded-2xl border bg-background shadow-xl duration-150"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Magic Agent help</p>
              <p className="text-xs text-muted-foreground">Knows the manual and your setup</p>
            </div>
            {turns.length ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear chat"
                disabled={pending}
                onClick={() => setTurns([])}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close help"
              onClick={() => setOpen(false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {turns.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Hi! Ask anything about Magic Agent. I can also see how your workspace is set up.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {suggestions === undefined ? (
                    <Spinner className="text-muted-foreground" />
                  ) : null}
                  {suggestions?.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {turns.map((turn, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word",
                      turn.role === "user"
                        ? "self-end bg-primary text-primary-foreground"
                        : turn.failed
                          ? "self-start bg-destructive/10 text-destructive"
                          : "self-start bg-muted"
                    )}
                  >
                    {turn.role === "assistant" ? <Formatted text={turn.text} /> : turn.text}
                  </div>
                ))}
                {pending ? (
                  <div className="flex items-center gap-2 self-start rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <Spinner /> Thinking…
                  </div>
                ) : null}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t p-3">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <Textarea
                ref={inputRef}
                value={draft}
                rows={1}
                maxLength={2000}
                placeholder="Ask a question…"
                className="max-h-32 min-h-9 resize-none"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon-lg"
                aria-label="Send"
                disabled={pending || !draft.trim()}
              >
                <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
              </Button>
            </form>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Need a person?{" "}
              <Link href={supportHref} className="underline" onClick={() => setOpen(false)}>
                Raise a support ticket
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {hideLauncher && !open ? null : (
        <Button
          size="icon-lg"
          aria-label={open ? "Close help" : "Open help"}
          aria-expanded={open}
          className="pointer-events-auto size-12 rounded-full shadow-lg"
          onClick={() => setOpen((o) => !o)}
        >
          <HugeiconsIcon
            icon={open ? Cancel01Icon : CustomerSupportIcon}
            strokeWidth={2}
            className="size-5"
          />
        </Button>
      )}
    </div>
  );
}
