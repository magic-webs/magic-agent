"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { fail, type InstagramRule } from "@/components/instagram/context";
import { PostPicker } from "@/components/instagram/post-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_POSTS = 20;

export type RuleDraft = {
  name: string;
  enabled: boolean;
  match: "any" | "keywords";
  keywords: string;
  allPosts: boolean;
  posts: InstagramRule["posts"];
  replyMode: "off" | "fixed" | "ai";
  variants: string;
  dmOn: boolean;
  dmText: string;
  buttonTitle: string;
  buttonUrl: string;
  oncePerUser: boolean;
};

export const PRESETS: Array<{ title: string; body: string; draft: RuleDraft }> = [
  {
    title: "Comment-to-DM",
    body: "“Comment PRICE and we’ll DM you” — replies under the comment and sends the details in a DM.",
    draft: {
      name: "Price in DM",
      enabled: true,
      match: "keywords",
      keywords: "price, cost, details, info",
      allPosts: true,
      posts: [],
      replyMode: "fixed",
      variants: "Sent you a DM {{username}} ✨\nCheck your DMs {{username}} 📩\nJust messaged you {{username}}!",
      dmOn: true,
      dmText: "Hi {{username}}! Thanks for your interest. Here are the details you asked for 👇",
      buttonTitle: "",
      buttonUrl: "",
      oncePerUser: true,
    },
  },
  {
    title: "Thank every commenter",
    body: "An AI-written public reply to every comment, in the agent’s tone.",
    draft: {
      name: "Thank commenters",
      enabled: true,
      match: "any",
      keywords: "",
      allPosts: true,
      posts: [],
      replyMode: "ai",
      variants: "",
      dmOn: false,
      dmText: "",
      buttonTitle: "",
      buttonUrl: "",
      oncePerUser: false,
    },
  },
];

const EMPTY: RuleDraft = {
  name: "",
  enabled: true,
  match: "keywords",
  keywords: "",
  allPosts: true,
  posts: [],
  replyMode: "fixed",
  variants: "",
  dmOn: true,
  dmText: "",
  buttonTitle: "",
  buttonUrl: "",
  oncePerUser: true,
};

export function draftFromRule(rule: InstagramRule): RuleDraft {
  return {
    name: rule.name,
    enabled: rule.enabled,
    match: rule.match,
    keywords: rule.keywords.join(", "),
    allPosts: rule.posts.length === 0,
    posts: rule.posts,
    replyMode: rule.publicReply.mode,
    variants: rule.publicReply.variants.join("\n"),
    dmOn: Boolean(rule.dm),
    dmText: rule.dm?.text ?? "",
    buttonTitle: rule.dm?.buttonTitle ?? "",
    buttonUrl: rule.dm?.buttonUrl ?? "",
    oncePerUser: rule.oncePerUser,
  };
}

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        if (picked) onChange(picked);
      }}
      className="w-fit rounded-lg border p-0.5"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function RuleDialog({
  channelId,
  ruleId,
  initial,
  onClose,
}: {
  channelId: Id<"channels">;
  ruleId?: Id<"instagramRules">;
  initial?: RuleDraft;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const save = useMutation(api.instagramAutomation.saveRule);
  const [draft, setDraft] = useState<RuleDraft>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        workspaceId: workspace._id,
        ruleId,
        channelId,
        name: draft.name,
        enabled: draft.enabled,
        match: draft.match,
        keywords: draft.keywords.split(/[,\n]/).map((word) => word.trim()).filter(Boolean),
        posts: draft.allPosts ? [] : draft.posts,
        publicReply: {
          mode: draft.replyMode,
          variants: draft.variants.split("\n").map((line) => line.trim()).filter(Boolean),
        },
        dm: draft.dmOn
          ? {
              text: draft.dmText,
              buttonTitle: draft.buttonTitle.trim() || undefined,
              buttonUrl: draft.buttonUrl.trim() || undefined,
            }
          : undefined,
        oncePerUser: draft.oncePerUser,
      });
      toast.add({ title: ruleId ? "Rule saved" : "Rule created", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save the rule", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ruleId ? "Edit rule" : "New comment rule"}</DialogTitle>
          <DialogDescription>
            When a comment matches, reply under it, send a DM, or both. Whatever they DM
            back goes to the agent.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Price in DM"
            />
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              When
            </h3>
            <Choice
              value={draft.match}
              onChange={(match) => set({ match })}
              options={[
                { value: "keywords", label: "Comment has a keyword" },
                { value: "any", label: "Any comment" },
              ]}
            />
            {draft.match === "keywords" ? (
              <div className="flex flex-col gap-1.5">
                <Input
                  value={draft.keywords}
                  onChange={(event) => set({ keywords: event.target.value })}
                  placeholder="price, details, link"
                  aria-label="Keywords"
                />
                <p className="text-xs text-muted-foreground">
                  Separate with commas. Whole words, any capitalisation.
                </p>
              </div>
            ) : null}

            <Choice
              value={draft.allPosts ? "all" : "some"}
              onChange={(value) => set({ allPosts: value === "all" })}
              options={[
                { value: "all", label: "On every post" },
                { value: "some", label: "On chosen posts" },
              ]}
            />
            {!draft.allPosts ? (
              <div className="flex flex-col gap-1.5">
                <PostPicker
                  channelId={channelId}
                  value={draft.posts}
                  onChange={(posts) => set({ posts })}
                  max={MAX_POSTS}
                />
                <p className="text-xs text-muted-foreground">
                  {draft.posts.length} of up to {MAX_POSTS} chosen. A rule for chosen posts
                  wins over one for every post.
                </p>
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Public reply
            </h3>
            <Choice
              value={draft.replyMode}
              onChange={(replyMode) => set({ replyMode })}
              options={[
                { value: "fixed", label: "Written here" },
                { value: "ai", label: "AI writes it" },
                { value: "off", label: "No reply" },
              ]}
            />
            {draft.replyMode === "fixed" ? (
              <div className="flex flex-col gap-1.5">
                <Textarea
                  rows={3}
                  value={draft.variants}
                  onChange={(event) => set({ variants: event.target.value })}
                  placeholder={"Sent you a DM {{username}} ✨\nCheck your DMs {{username}} 📩"}
                  aria-label="Public replies"
                />
                <p className="text-xs text-muted-foreground">
                  One reply per line, picked at random so the replies don’t all look the
                  same. {"{{username}}"} becomes their @handle.
                </p>
              </div>
            ) : draft.replyMode === "ai" ? (
              <p className="text-xs text-muted-foreground">
                One or two sentences in the agent’s tone, from the comment and the post’s
                caption. It never quotes prices. Billed as AI usage.
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Private DM
              </h3>
              <Switch
                checked={draft.dmOn}
                onCheckedChange={(dmOn) => set({ dmOn })}
                aria-label="Send a DM"
              />
            </div>
            {draft.dmOn ? (
              <>
                <Textarea
                  rows={4}
                  value={draft.dmText}
                  onChange={(event) => set({ dmText: event.target.value })}
                  placeholder="Hi {{username}}! Here are the details you asked for 👇"
                  aria-label="DM text"
                />
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                  <Input
                    value={draft.buttonTitle}
                    maxLength={20}
                    onChange={(event) => set({ buttonTitle: event.target.value })}
                    placeholder="Button label (optional)"
                    aria-label="Button label"
                  />
                  <Input
                    value={draft.buttonUrl}
                    onChange={(event) => set({ buttonUrl: event.target.value })}
                    placeholder="https://…"
                    aria-label="Button link"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Instagram allows one DM per comment, within 7 days of it. It appears in
                  the Inbox, and the agent picks up when they reply.
                </p>
              </>
            ) : null}
          </section>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="rule-once">Once per person</Label>
                <p className="text-xs text-muted-foreground">
                  Answer someone’s first matching comment only, not every one they write.
                </p>
              </div>
              <Switch
                id="rule-once"
                checked={draft.oncePerUser}
                onCheckedChange={(oncePerUser) => set({ oncePerUser })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="rule-live">Live</Label>
              <Switch
                id="rule-live"
                checked={draft.enabled}
                onCheckedChange={(enabled) => set({ enabled })}
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner /> : null} {ruleId ? "Save" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
