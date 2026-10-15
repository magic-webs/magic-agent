"use client";

import { createContext, useContext } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";

export type InstagramOverview = FunctionReturnType<typeof api.instagramAutomation.overview>;
export type InstagramChannel = InstagramOverview["channels"][number];
export type InstagramRule = FunctionReturnType<typeof api.instagramAutomation.listRules>[number];

type InstagramContextValue = {
  overview: InstagramOverview;
  channel: InstagramChannel;
  setChannelId: (id: Id<"channels">) => void;
};

export const InstagramContext = createContext<InstagramContextValue | null>(null);

export function useInstagram() {
  const value = useContext(InstagramContext);
  if (!value) throw new Error("useInstagram must be used inside the Instagram layout");
  return value;
}

export function fail(title: string, error: unknown) {
  toast.add({ title, description: friendlyError(error), type: "error" });
}

export const INSTAGRAM_GRADIENT =
  "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]";

export const ACTION_LABEL: Record<string, string> = {
  public_reply: "Replied",
  dm: "DM sent",
  hidden: "Hidden",
  deleted: "Deleted",
};
