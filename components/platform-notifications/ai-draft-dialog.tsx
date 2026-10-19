"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/components/admin-account-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { SparkleIcon } from "@phosphor-icons/react";
import { CATEGORIES, type Category, type Channel } from "./shared";

export type AiDraft = {
  category: Category;
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
  smsText: string;
  linkLabel: string;
};

type Language = "english" | "hindi" | "hinglish";

const EXAMPLES = [
  "Instagram comment automation is live: reply to comments and DM people who comment a keyword",
  "Diwali offer: [X]% off yearly plans until [date]",
  "Scheduled maintenance on [date] from 1 to 3 AM IST",
];

export function AiDraftDialog({
  open,
  onOpenChange,
  channels,
  emailFormat,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Record<Channel, boolean>;
  emailFormat: "text" | "html";
  onDraft: (draft: AiDraft) => void;
}) {
  const draft = useAction(api.platformNotificationsAi.draft);
  const [brief, setBrief] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [language, setLanguage] = useState<Language>("english");
  const [busy, setBusy] = useState(false);

  const write = async () => {
    setBusy(true);
    try {
      const result = await draft({
        brief,
        category: category || undefined,
        channels,
        emailFormat,
        language,
      });
      onDraft(result);
    } catch (error) {
      toast.add({ title: "Could not write a draft", description: errorText(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparkleIcon className="size-4" /> Draft with AI
          </DialogTitle>
          <DialogDescription>
            Say what the notification is about. AI writes the push, email
            {emailFormat === "html" ? " (as HTML)" : ""} and SMS, and leaves anything it does not
            know — prices, dates, codes — as [placeholders].
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-brief">What is it about?</Label>
            <Textarea
              id="ai-brief"
              rows={5}
              value={brief}
              placeholder="New: agents can send the full catalogue as a WhatsApp list. Turn it on from Catalogue → Settings."
              onChange={(event) => setBrief(event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setBrief(example)}
                  className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-category">Type</Label>
              <NativeSelect
                id="ai-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as Category | "")}
              >
                <NativeSelectOption value="">Let AI choose</NativeSelectOption>
                {CATEGORIES.map((item) => (
                  <NativeSelectOption key={item.value} value={item.value}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-language">Language</Label>
              <NativeSelect
                id="ai-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
              >
                <NativeSelectOption value="english">English</NativeSelectOption>
                <NativeSelectOption value="hindi">Hindi</NativeSelectOption>
                <NativeSelectOption value="hinglish">Hinglish</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || brief.trim().length < 5} onClick={() => void write()}>
            {busy ? <Spinner /> : <SparkleIcon />} {busy ? "Writing…" : "Write draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
