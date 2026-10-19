"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SelectField } from "@/components/select-field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { ChannelQr } from "@/components/channel-qr";
import { InstagramLogo, RcsLogo, TelegramLogo } from "@/components/brand-icons";
import {
  CHANNEL_LABEL,
  ChannelGlyph,
  type ChannelKind,
} from "@/components/channel-mark";
import { CardGridSkeleton } from "@/components/skeletons";
import {
  WhatsappLogoIcon,
  PlusIcon,
  CopyIcon,
  WarningIcon,
  InfoIcon,
  GlobeIcon,
  ChatCircleIcon,
  UsersIcon,
  DotsThreeIcon,
  ArrowsDownUpIcon,
  GearIcon,
  RowsIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Clipboard write plus the toast, in one place — six things copy on this page. */
async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${label} copied`, type: "success" });
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Select the text and copy it manually.",
      type: "error",
    });
  }
}

function CopyButton({
  value,
  label,
  size = "icon-lg",
}: {
  value: string;
  label: string;
  size?: "icon" | "icon-lg";
}) {
  return (
    <Button
      size={size}
      variant="ghost"
      aria-label={`Copy ${label}`}
      onClick={() => void copyText(value, label)}
    >
      <CopyIcon />
    </Button>
  );
}

/**
 * A read-only value the operator has to paste somewhere else.
 *
 * Not an `<Input>`: these are never edited, and a form control here invites a
 * click-and-type that silently does nothing. A bordered block with the copy
 * button inside it says "take this" rather than "fill this in".
 */
function CopyField({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-stretch gap-1 rounded-lg border border-border bg-muted/40 p-1 pl-3">
        <code className="min-w-0 flex-1 self-center break-all py-1.5 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          className="self-center bg-background"
          onClick={() => void copyText(value, label)}
        >
          <CopyIcon /> Copy
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** One figure on a channel card: how much has actually come through it. */
function StatTile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="flex min-w-24 items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** One read-only identifier in a WhatsApp card's footer. */
function MetaField({
  label,
  value,
  copyable = true,
}: {
  label: string;
  value: string | undefined;
  copyable?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-0.5">
        <p className="truncate font-mono text-xs">{value || "—"}</p>
        {copyable && value ? (
          <CopyButton value={value} label={label} size="icon" />
        ) : null}
      </div>
    </div>
  );
}

/** The long-form guidance, moved off the card and behind a button. */
function GuideDialog({
  title,
  description,
  trigger,
  children,
}: {
  title: string;
  description: string;
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A `data-` attribute of the embed script, in the options dialog. */
function OptionRow({
  attribute,
  children,
}: {
  attribute: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
      <code className="font-mono text-xs text-foreground">{attribute}</code>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

// The list of agents a channel may point at. The front desk comes first and is
// labelled, because pointing a channel anywhere else deliberately bypasses
// routing — the chosen agent then answers every message itself.
type AgentOption = {
  _id: string;
  botName: string;
  name: string;
  kind?: "router" | "specialist" | "follow_up" | "marketing";
};

function defaultChannelAgentId(
  agents: AgentOption[] | undefined
): string | undefined {
  if (!agents?.length) return undefined;
  const router = agents.find((agent) => agent.kind === "router");
  return (router ?? agents[0])._id;
}

function agentOptions(agents: AgentOption[] | undefined) {
  const sorted = [...(agents ?? [])].sort((a, b) =>
    a.kind === "router" ? -1 : b.kind === "router" ? 1 : 0
  );
  return sorted.map((agent) => ({
    value: agent._id,
    label:
      agent.kind === "router"
        ? `${agent.botName} — front desk (routes to your agents)`
        : `${agent.botName} — ${agent.name}`,
  }));
}

type ChannelForm = {
  name: string;
  agentId: string;
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  wabaId: string;
  businessId: string;
  displayPhoneNumber: string;
  accessToken: string;
};

const emptyForm: ChannelForm = {
  name: "WhatsApp",
  agentId: "",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v23.0",
  phoneNumberId: "",
  wabaId: "",
  businessId: "",
  displayPhoneNumber: "",
  accessToken: "",
};

function ChannelDialog({
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  channelId?: Id<"channels">;
  initial?: ChannelForm;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ChannelForm>(initial ?? emptyForm);

  // Derived, not stored, so no effect is needed to backfill it once the agent
  // list arrives. A new channel defaults to the front desk, which is what
  // "route every incoming message" means in practice.
  const selectedAgentId =
    form.agentId || defaultChannelAgentId(agents) || "";

  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!selectedAgentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    if (!form.phoneNumberId.trim()) {
      toast.add({ title: "A phone number ID is required", type: "error" });
      return;
    }
    if (!channelId && !form.accessToken.trim()) {
      toast.add({ title: "An access token is required", type: "error" });
      return;
    }

    const whatsapp = {
      apiBaseUrl: form.apiBaseUrl.trim(),
      apiVersion: form.apiVersion.trim(),
      phoneNumberId: form.phoneNumberId.trim(),
      wabaId: form.wabaId.trim() || undefined,
      businessId: form.businessId.trim() || undefined,
      displayPhoneNumber: form.displayPhoneNumber.trim() || undefined,
      accessToken: form.accessToken.trim() || undefined,
    };

    setBusy(true);
    try {
      if (channelId) {
        await updateChannel({
          channelId,
          name: form.name,
          agentId: selectedAgentId as Id<"agents">,
          whatsapp,
        });
        toast.add({ title: "Channel updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: selectedAgentId as Id<"agents">,
          type: "whatsapp",
          name: form.name,
          whatsapp,
        });
        toast.add({
          title: "Channel created",
          description:
            "Copy the webhook URL and verify token into Meta, then set it live.",
          type: "success",
        });
        setForm(emptyForm);
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {channelId ? "Edit WhatsApp channel" : "Connect a WhatsApp number"}
          </DialogTitle>
          <DialogDescription>
            These credentials come from your WhatsApp Business Platform app.
            Every channel stores its own set, so one workspace can run several
            numbers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-name">Channel name</Label>
              <Input
                id="c-name"
                value={form.name}
                placeholder="Channel name"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-agent">Agent that answers</Label>
              <SelectField
                id="c-agent"
                className="w-full"
                value={selectedAgentId}
                placeholder="No agents yet"
                onValueChange={(next) => set("agentId", next)}
                options={agentOptions(agents)}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-phone-id">Phone number ID</Label>
              <Input
                id="c-phone-id"
                className="font-mono"
                value={form.phoneNumberId}
                placeholder="Phone number ID"
                onChange={(event) => set("phoneNumberId", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-display">Display number</Label>
              <Input
                id="c-display"
                value={form.displayPhoneNumber}
                placeholder="Phone number"
                onChange={(event) =>
                  set("displayPhoneNumber", event.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-waba">WABA ID</Label>
              <Input
                id="c-waba"
                className="font-mono"
                value={form.wabaId}
                placeholder="WABA ID"
                onChange={(event) => set("wabaId", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-business">Business ID</Label>
              <Input
                id="c-business"
                className="font-mono"
                value={form.businessId}
                placeholder="Business ID"
                onChange={(event) => set("businessId", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-token">
              Access token
              {channelId ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  — leave blank to keep the stored one
                </span>
              ) : null}
            </Label>
            <Input
              id="c-token"
              type="password"
              className="font-mono"
              value={form.accessToken}
              placeholder={channelId ? "••••••••" : "Access token"}
              onChange={(event) => set("accessToken", event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-base">API base URL</Label>
              <Input
                id="c-base"
                className="font-mono"
                value={form.apiBaseUrl}
                onChange={(event) => set("apiBaseUrl", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Change this if you send through a BSP proxy instead of Meta
                directly.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-version">API version</Label>
              <Input
                id="c-version"
                className="font-mono"
                value={form.apiVersion}
                onChange={(event) => set("apiVersion", event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {channelId ? "Save changes" : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ProviderKind = "rcs" | "telegram";

type ProviderChannelForm = {
  name: string;
  agentId: string;
  token: string;
  apiBaseUrl: string;
  displayPhoneNumber: string;
};

const RCS_BASE_URL = "https://crmapi.com.bot/api/v1";

const emptyProviderForm = (kind: ProviderKind): ProviderChannelForm => ({
  name: CHANNEL_LABEL[kind],
  agentId: "",
  token: "",
  apiBaseUrl: RCS_BASE_URL,
  displayPhoneNumber: "",
});

function ProviderChannelDialog({
  kind,
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  kind: ProviderKind;
  channelId?: Id<"channels">;
  initial?: ProviderChannelForm;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ProviderChannelForm>(
    initial ?? emptyProviderForm(kind)
  );
  const selectedAgentId = form.agentId || defaultChannelAgentId(agents) || "";
  const set = <K extends keyof ProviderChannelForm>(
    key: K,
    value: ProviderChannelForm[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const isTelegram = kind === "telegram";
  const tokenLabel = isTelegram ? "Bot token" : "Access token";

  const submit = async () => {
    if (!selectedAgentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    if (!channelId && !form.token.trim()) {
      toast.add({ title: `A ${tokenLabel.toLowerCase()} is required`, type: "error" });
      return;
    }
    const token = form.token.trim() || undefined;
    const provider = isTelegram
      ? { telegram: { botToken: token } }
      : {
          rcs: {
            accessToken: token,
            apiBaseUrl: form.apiBaseUrl.trim() || undefined,
            displayPhoneNumber: form.displayPhoneNumber.trim() || undefined,
          },
        };

    setBusy(true);
    try {
      if (channelId) {
        await updateChannel({
          channelId,
          name: form.name,
          agentId: selectedAgentId as Id<"agents">,
          ...provider,
        });
        toast.add({ title: "Channel updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: selectedAgentId as Id<"agents">,
          type: kind,
          name: form.name,
          ...provider,
        });
        toast.add({
          title: "Channel created",
          description: isTelegram
            ? "The bot is being connected. It goes live as soon as Telegram accepts the webhook."
            : "Copy the callback URL into your RCS provider's webhook settings.",
          type: "success",
        });
        setForm(emptyProviderForm(kind));
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {channelId
              ? `Edit ${CHANNEL_LABEL[kind]} channel`
              : isTelegram
                ? "Connect a Telegram bot"
                : "Connect an RCS sender"}
          </DialogTitle>
          <DialogDescription>
            {isTelegram
              ? "Create a bot with @BotFather in Telegram and paste the token it gives you. The webhook is set on the bot for you."
              : "Paste the token from your RCS channel. Every channel stores its own, so one workspace can run several senders."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-name`}>Channel name</Label>
              <Input
                id={`${kind}-name`}
                value={form.name}
                placeholder="Channel name"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${kind}-agent`}>Agent that answers</Label>
              <SelectField
                id={`${kind}-agent`}
                className="w-full"
                value={selectedAgentId}
                placeholder="No agents yet"
                onValueChange={(next) => set("agentId", next)}
                options={agentOptions(agents)}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${kind}-token`}>
              {tokenLabel}
              {channelId ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  — leave blank to keep the stored one
                </span>
              ) : null}
            </Label>
            <Input
              id={`${kind}-token`}
              type="password"
              className="font-mono"
              value={form.token}
              placeholder={
                channelId ? "••••••••" : isTelegram ? "123456789:AA…" : tokenLabel
              }
              onChange={(event) => set("token", event.target.value)}
            />
          </div>

          {isTelegram ? null : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rcs-display">Sender number</Label>
                <Input
                  id="rcs-display"
                  value={form.displayPhoneNumber}
                  placeholder="Phone number"
                  onChange={(event) => set("displayPhoneNumber", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rcs-base">API base URL</Label>
                <Input
                  id="rcs-base"
                  className="font-mono"
                  value={form.apiBaseUrl}
                  onChange={(event) => set("apiBaseUrl", event.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {channelId ? "Save changes" : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type WebChannelForm = {
  name: string;
  agentId: string;
  intake: "chat" | "form" | "";
};

const emptyWebForm: WebChannelForm = {
  name: "Website Widget",
  agentId: "",
  intake: "",
};

type InstagramChannelForm = Omit<WebChannelForm, "intake">;

const INTAKE_OPTIONS = [
  {
    value: "chat",
    title: "In the chat",
    description:
      "The widget opens on the conversation and the agent asks for the visitor's name, then their number with country code.",
  },
  {
    value: "form",
    title: "Sign-in page first",
    description:
      "Visitors fill in their name and number on a start page before the chat opens.",
  },
] as const;

function WebChannelDialog({
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  channelId?: Id<"channels">;
  initial?: WebChannelForm;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<WebChannelForm>(initial ?? emptyWebForm);

  const selectedAgentId =
    form.agentId || defaultChannelAgentId(agents) || "";

  const set = <K extends keyof WebChannelForm>(key: K, value: WebChannelForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!selectedAgentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    if (!form.intake) {
      toast.add({
        title: "Choose how the widget asks for name and number",
        type: "error",
      });
      return;
    }

    setBusy(true);
    try {
      if (channelId) {
        await updateChannel({
          channelId,
          name: form.name,
          agentId: selectedAgentId as Id<"agents">,
          intake: form.intake,
        });
        toast.add({ title: "Channel updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: selectedAgentId as Id<"agents">,
          type: "web",
          name: form.name,
          intake: form.intake,
        });
        toast.add({
          title: "Channel created",
          description: "Your web widget is ready to be embedded.",
          type: "success",
        });
        setForm(emptyWebForm);
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {channelId ? "Edit Web Widget" : "Create a Web Widget"}
          </DialogTitle>
          <DialogDescription>
            A web widget lets you embed your agent directly into your website.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="w-name">Widget name</Label>
              <Input
                id="w-name"
                value={form.name}
                placeholder="Channel name"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="w-agent">Agent that answers</Label>
              <SelectField
                id="w-agent"
                className="w-full"
                value={selectedAgentId}
                placeholder="No agents yet"
                onValueChange={(next) => set("agentId", next)}
                options={agentOptions(agents)}
              />
              <p className="text-xs text-muted-foreground">
                Leave this on the front desk unless you want one agent to handle
                every message on this widget without routing.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Collect visitor details</Label>
            <div
              role="radiogroup"
              aria-label="Collect visitor details"
              className="grid gap-2 sm:grid-cols-2"
            >
              {INTAKE_OPTIONS.map((option) => {
                const chosen = form.intake === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => set("intake", option.value)}
                    className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                      chosen
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-sm font-medium">{option.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}{" "}
            {channelId ? "Save changes" : "Create widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INSTAGRAM_GRADIENT =
  "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]";

function useInstagramConnect() {
  const workspace = useWorkspace();
  const startConnect = useAction(api.instagram.startConnect);
  const [busy, setBusy] = useState(false);

  const connect = async (agentId: string, name: string) => {
    setBusy(true);
    try {
      const { url } = await startConnect({
        workspaceId: workspace._id,
        agentId: agentId as Id<"agents">,
        name,
        returnTo: `${window.location.origin}/w/${workspace.slug}/channels`,
      });
      window.location.assign(url);
    } catch (error) {
      toast.add({
        title: "Could not start Instagram sign-in",
        description: friendlyError(error),
        type: "error",
      });
      setBusy(false);
    }
  };

  return { connect, busy };
}

function InstagramDialog({
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  channelId?: Id<"channels">;
  initial?: InstagramChannelForm;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const updateChannel = useMutation(api.channels.update);
  const { connect, busy: connecting } = useInstagramConnect();

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<InstagramChannelForm>(
    initial ?? { name: "Instagram", agentId: "" }
  );
  const busy = saving || connecting;

  const selectedAgentId =
    form.agentId || defaultChannelAgentId(agents) || "";

  const submit = async () => {
    if (!selectedAgentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    if (!channelId) {
      await connect(selectedAgentId, form.name);
      return;
    }

    setSaving(true);
    try {
      await updateChannel({
        channelId,
        name: form.name,
        agentId: selectedAgentId as Id<"agents">,
      });
      toast.add({ title: "Channel updated", type: "success" });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {channelId ? "Edit Instagram" : "Connect Instagram"}
          </DialogTitle>
          <DialogDescription>
            {channelId
              ? "Rename this account or change the agent that answers its messages."
              : "Sign in with the Instagram professional account whose direct messages your agent should answer."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-name">Channel name</Label>
            <Input
              id="ig-name"
              value={form.name}
              placeholder="Channel name"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ig-agent">Agent that answers</Label>
            <SelectField
              id="ig-agent"
              className="w-full"
              value={selectedAgentId}
              placeholder="No agents yet"
              onValueChange={(next) =>
                setForm((prev) => ({ ...prev, agentId: next }))
              }
              options={agentOptions(agents)}
            />
          </div>
        </div>

        {channelId ? null : (
          <p className="text-xs text-muted-foreground">
            Only business and creator accounts can be connected. After signing
            in, turn on{" "}
            <strong className="text-foreground">Allow access to messages</strong>{" "}
            in the Instagram app under Settings {"→"} Messages and story replies{" "}
            {"→"} Connected tools.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {channelId ? (
            <Button onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : null} Save changes
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={busy}
              className={`${INSTAGRAM_GRADIENT} text-white hover:opacity-90`}
            >
              {busy ? <Spinner /> : <InstagramLogo />} Continue with Instagram
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectInstagramButton() {
  return (
    <InstagramDialog
      trigger={
        <Button className={`${INSTAGRAM_GRADIENT} text-white hover:opacity-90`}>
          <InstagramLogo /> Connect Instagram
        </Button>
      }
    />
  );
}

/**
 * A row's action menu.
 *
 * Rotate, Edit and Delete were three buttons on every card, which put the
 * destructive one a stray click from the useful ones and cost a whole row of
 * vertical space per channel. Behind one trigger they are still two clicks and
 * the card gets its header back.
 *
 * The edit dialog and both confirmations are rendered as siblings of the menu,
 * not inside it. A dialog mounted inside `DropdownMenuContent` is unmounted
 * as soon as the menu closes, which the first click inside the dialog does.
 */
const GONE_WHEN_DELETED: Record<ChannelKind, string> = {
  web: "the widget on your website stops loading.",
  instagram: "direct messages to this Instagram account stop being answered.",
  whatsapp: "inbound WhatsApp messages to this number stop being answered.",
  rcs: "inbound RCS messages to this sender stop being answered.",
  telegram: "messages to this Telegram bot stop being answered.",
};

const AFTER_ROTATE: Record<ChannelKind, string> = {
  web: "The script tag already on your website stops loading the moment this changes. You will need to paste the new one in its place.",
  instagram: "",
  whatsapp: "Inbound messages stop until you set the new URL in Meta and verify it again. Conversations already received are untouched.",
  rcs: "Inbound messages stop until you set the new URL with your RCS provider. Conversations already received are untouched.",
  telegram: "The bot is pointed at the new URL for you. Conversations already received are untouched.",
};

function ChannelMenu({
  kind,
  onEdit,
  onRotate,
  onReconnect,
  onDelete,
}: {
  kind: ChannelKind;
  onEdit: () => void;
  onRotate: () => Promise<void>;
  onReconnect: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isWeb = kind === "web";
  const isInstagram = kind === "instagram";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="icon-lg" variant="ghost" aria-label="Channel actions">
              <DotsThreeIcon weight="bold" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
          {isInstagram ? (
            <DropdownMenuItem onClick={() => void onReconnect()}>
              Reconnect Instagram
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setRotating(true)}>
              {isWeb ? "Rotate embed code" : "Rotate callback URL"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            Delete channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={rotating} onOpenChange={setRotating}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isWeb
                ? "Generate a new embed code?"
                : "Generate a new callback URL?"}
            </AlertDialogTitle>
            <AlertDialogDescription>{AFTER_ROTATE[kind]}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRotate()}>
              Rotate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers can no longer reach you here, and{" "}
              {GONE_WHEN_DELETED[kind]}{" "}
              Conversations already received are kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "rcs", label: "RCS" },
  { value: "telegram", label: "Telegram" },
  { value: "web", label: "Website" },
  { value: "inactive", label: "Inactive" },
] as const;

type ChannelFilter = (typeof FILTERS)[number]["value"];

const SORTS = [
  { value: "updated", label: "Last updated" },
  { value: "busiest", label: "Most messages" },
  { value: "name", label: "Name" },
] as const;

type ChannelSort = (typeof SORTS)[number]["value"];

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-primary/30 bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-xs tabular-nums ${
          active ? "bg-primary/15" : "bg-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// One channel, two ways to draw it
// ---------------------------------------------------------------------------

type ChannelRow = FunctionReturnType<typeof api.channels.listByWorkspace>[number];

/** The addresses a channel is reached at, worked out once per render. */
type ChannelLinks = {
  kind: ChannelKind;
  isWeb: boolean;
  isInstagram: boolean;
  igLink: string | null;
  live: boolean;
  webhookUrl: string;
  widgetUrl: string;
  embedCode: string;
  chatLink: string | null;
};

function chatLinkFor(channel: ChannelRow): string | null {
  if (channel.type === "telegram") {
    return channel.telegram?.botUsername
      ? `https://t.me/${channel.telegram.botUsername}`
      : null;
  }
  const digits = (
    channel.type === "rcs"
      ? (channel.rcs?.displayPhoneNumber ?? "")
      : (channel.whatsapp?.displayPhoneNumber ?? "")
  ).replace(/[^0-9]/g, "");
  if (!digits) return null;
  return channel.type === "rcs" ? `sms:+${digits}` : `https://wa.me/${digits}`;
}

function channelLinks(
  channel: ChannelRow,
  appOrigin: string,
  webhookBase: string
): ChannelLinks {
  return {
    kind: channel.type,
    isWeb: channel.type === "web",
    isInstagram: channel.type === "instagram",
    igLink: channel.instagram
      ? `https://ig.me/m/${channel.instagram.username}`
      : null,
    live: channel.status === "active",
    webhookUrl: `${webhookBase}/${channel.type === "rcs" ? "rcs" : "whatsapp"}/${channel.channelKey}`,
    widgetUrl: `${appOrigin}/widget/${channel.channelKey}`,
    // A script, not a bare iframe: the launcher button has to live in the host
    // page, because an iframe cannot resize itself there.
    embedCode: `<script src="${appOrigin}/widget/${channel.channelKey}/embed.js" async></script>`,
    chatLink: chatLinkFor(channel),
  };
}

/** The on/off switch and the overflow menu — the same on both cards. */
function ChannelControls({
  channel,
  links,
  compact = false,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
  /** The small card has no room for the switch's label. */
  compact?: boolean;
}) {
  const updateChannel = useMutation(api.channels.update);
  const rotateKeys = useMutation(api.channels.rotateKeys);
  const removeChannel = useMutation(api.channels.remove);
  const { connect } = useInstagramConnect();
  const { kind, isWeb, isInstagram, live } = links;
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 pl-1">
        <Switch
          id={`live-${channel._id}`}
          checked={live}
          onCheckedChange={async (checked) => {
            await updateChannel({
              channelId: channel._id,
              status: checked ? "active" : "paused",
            });
            toast.add({
              title: checked
                ? "Channel is live"
                : "Channel paused",
              type: "success",
            });
          }}
        />
        <Label
          htmlFor={`live-${channel._id}`}
          className={compact ? "sr-only" : "hidden text-sm xl:block"}
        >
          Accept inbound messages
        </Label>
      </div>

      <ChannelMenu
        kind={kind}
        onReconnect={() => connect(channel.agentId, channel.name)}
        onRotate={async () => {
          await rotateKeys({ channelId: channel._id });
          toast.add({
            title: isWeb
              ? "New embed code generated"
              : "New callback URL generated",
            description: isWeb
              ? "Replace the script tag on your website or the widget will stop loading."
              : kind === "telegram"
                ? "The bot is being pointed at the new URL."
                : kind === "rcs"
                  ? "Update the webhook with your RCS provider or inbound messages will stop."
                  : "Update the configuration in Meta or inbound messages will stop.",
            type: kind === "telegram" ? "success" : "warning",
          });
        }}
        onDelete={async () => {
          await removeChannel({ channelId: channel._id });
          toast.add({ title: "Channel deleted", type: "success" });
        }}
        onEdit={() => setEditing(true)}
      />

      {editing ? (
        isInstagram ? (
          <InstagramDialog
            channelId={channel._id}
            initial={{ name: channel.name, agentId: channel.agentId }}
            open
            onOpenChange={setEditing}
          />
        ) : kind === "rcs" || kind === "telegram" ? (
          <ProviderChannelDialog
            kind={kind}
            channelId={channel._id}
            initial={{
              name: channel.name,
              agentId: channel.agentId,
              token: "",
              apiBaseUrl: channel.rcs?.apiBaseUrl ?? RCS_BASE_URL,
              displayPhoneNumber: channel.rcs?.displayPhoneNumber ?? "",
            }}
            open
            onOpenChange={setEditing}
          />
        ) : isWeb ? (
          <WebChannelDialog
            channelId={channel._id}
            initial={{
              name: channel.name,
              agentId: channel.agentId,
              intake: channel.intake ?? "form",
            }}
            open
            onOpenChange={setEditing}
          />
        ) : (
          <ChannelDialog
            channelId={channel._id}
            initial={{
              name: channel.name,
              agentId: channel.agentId,
              apiBaseUrl:
                channel.whatsapp?.apiBaseUrl ??
                "https://graph.facebook.com",
              apiVersion:
                channel.whatsapp?.apiVersion ?? "v23.0",
              phoneNumberId:
                channel.whatsapp?.phoneNumberId ?? "",
              wabaId: channel.whatsapp?.wabaId ?? "",
              businessId: channel.whatsapp?.businessId ?? "",
              displayPhoneNumber:
                channel.whatsapp?.displayPhoneNumber ?? "",
              accessToken: "",
            }}
            open
            onOpenChange={setEditing}
          />
        )
      ) : null}
    </>
  );
}

/**
 * How to reach the channel and wire it up: the embed code or callback URL,
 * the QR code, the setup guide and the WhatsApp identifiers. The body of the
 * full card, and what the small card opens.
 */
function ChannelSetup({
  channel,
  links,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
}) {
  const { kind, isWeb, isInstagram, webhookUrl, widgetUrl, embedCode, chatLink } = links;

  if (isInstagram) return <InstagramSetup channel={channel} links={links} />;
  if (kind === "telegram") return <TelegramSetup channel={channel} links={links} />;

  return (
    <>
      {channel.lastError ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Last delivery problem</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {channel.lastError}
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          isWeb && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        )}
      >
        {isWeb ? (
          <Tabs defaultValue="embed" className="min-w-0">
            <TabsList>
              <TabsTrigger value="embed">Embed code</TabsTrigger>
              <TabsTrigger value="link">Direct link</TabsTrigger>
              <TabsTrigger value="qr">QR code</TabsTrigger>
            </TabsList>
            <TabsContent value="embed">
              <CopyField
                value={embedCode}
                label="Embed code"
                hint="Paste it once, anywhere before the closing </body> tag."
              />
            </TabsContent>
            <TabsContent value="link">
              <CopyField
                value={widgetUrl}
                label="Direct link"
                hint="The chat on its own page — handy for testing, or for a link in an email."
              />
            </TabsContent>
            <TabsContent value="qr">
              <ChannelQr
                url={widgetUrl}
                caption="Point a phone camera at this to open the widget on the handset — the quickest way to see what a visitor sees, on the screen size they will see it on."
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue="callback" className="min-w-0">
            <TabsList>
              <TabsTrigger value="callback">Callback URL</TabsTrigger>
              <TabsTrigger value="qr">QR code</TabsTrigger>
            </TabsList>
            <TabsContent value="callback">
              <CopyField
                value={webhookUrl}
                label="Callback URL"
                hint={
                  kind === "rcs"
                    ? "Set this as the inbound webhook on your RCS channel with the provider."
                    : "Set this in your Meta App → WhatsApp → Configuration → Webhooks."
                }
              />
            </TabsContent>
            <TabsContent value="qr">
              <ChannelQr
                url={chatLink}
                caption={
                  kind === "rcs"
                    ? "Point a phone camera at this to open a message to this sender in the phone's messages app. Send anything and the front desk answers."
                    : "Point a phone camera at this to open a WhatsApp chat with this number, already addressed. Send anything and the front desk answers."
                }
                unavailable={
                  kind === "rcs"
                    ? "This channel has no sender number saved. Add it under Edit."
                    : "This channel has no display phone number saved, and that is the only field a wa.me link can be built from — Meta's phone number ID is an internal handle, not a dialable number. Add it under Edit."
                }
              />
            </TabsContent>
          </Tabs>
        )}

        {/* The short version on the card, the whole thing one click
            away. This guidance used to be eight lines of prose per
            card, which is how a page with two channels became a
            page you scroll. */}
        {isWeb ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <InfoIcon className="size-4 text-muted-foreground" />
              What your visitors see
            </p>
            <p className="text-xs text-muted-foreground">
              A round chat button in the bottom-right corner.
              Clicking it slides the chat open; on a phone it fills
              the screen. Colour, side, icon and teaser are all set
              on the script tag.
            </p>
            <GuideDialog
              title="Customising the widget"
              description="Add any of these to the script tag. All optional."
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 self-start bg-background"
                >
                  <GearIcon /> View customisation options
                </Button>
              }
            >
              <OptionRow attribute={'data-color="#25D366"'}>
                Recolours the launcher and the chat header
                together. Any CSS colour.
              </OptionRow>
              <OptionRow attribute={'data-position="left"'}>
                Moves the launcher to the bottom-left. Defaults to
                the right.
              </OptionRow>
              <OptionRow attribute={'data-icon="chat"'}>
                Swaps the WhatsApp glyph for a neutral speech
                bubble — use it when the widget is not WhatsApp.
              </OptionRow>
              <OptionRow attribute={'data-teaser="Need a hand?"'}>
                A one-line bubble beside the launcher before anyone
                clicks it.
              </OptionRow>
              <OptionRow attribute={'data-auto-open="5000"'}>
                Opens the chat itself after this many
                milliseconds. Leave it off unless you mean it.
              </OptionRow>
            </GuideDialog>
          </div>
        ) : null}
      </div>

      {kind === "rcs" ? (
        <>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetaField label="Sender number" value={channel.rcs?.displayPhoneNumber} />
            <MetaField label="API base URL" value={channel.rcs?.apiBaseUrl} />
            <MetaField
              label="Access token"
              value={channel.hasAccessToken ? channel.rcs?.accessToken : "not set"}
              copyable={false}
            />
          </div>
        </>
      ) : !isWeb ? (
        <>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetaField
              label="Phone number ID"
              value={channel.whatsapp?.phoneNumberId}
            />
            <MetaField
              label="WABA ID"
              value={channel.whatsapp?.wabaId}
            />
            <MetaField
              label="Business ID"
              value={channel.whatsapp?.businessId}
            />
            {/* No copy button and no reveal here. The token is
                masked in Convex and the browser only ever receives
                the last four characters, so an eye would promise to
                show something that was never sent and a copy would
                paste dots into Meta. Enough to tell which token is
                in use; replace it under Edit. */}
            <MetaField
              label="Access token"
              value={
                channel.hasAccessToken
                  ? channel.whatsapp?.accessToken
                  : "not set"
              }
              copyable={false}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function TelegramSetup({
  channel,
  links,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
}) {
  return (
    <>
      {channel.lastError ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Last delivery problem</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {channel.lastError}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Tabs defaultValue="link" className="min-w-0">
          <TabsList>
            <TabsTrigger value="link">Bot link</TabsTrigger>
            <TabsTrigger value="qr">QR code</TabsTrigger>
          </TabsList>
          <TabsContent value="link">
            {links.chatLink ? (
              <CopyField
                value={links.chatLink}
                label="Bot link"
                hint="Share it anywhere — it opens a chat with the bot in Telegram."
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The bot&apos;s username appears here once Telegram accepts the token.
              </p>
            )}
          </TabsContent>
          <TabsContent value="qr">
            <ChannelQr
              url={links.chatLink}
              caption="Point a phone camera at this to open a chat with the bot in Telegram. Send anything and the front desk answers."
              unavailable="The bot's username appears here once Telegram accepts the token."
            />
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <InfoIcon className="size-4 text-muted-foreground" />
            Nothing to set up
          </p>
          <p className="text-xs text-muted-foreground">
            The webhook is set on the bot when the channel is saved, and again
            whenever the token changes. Only private chats with the bot are
            answered; groups are ignored.
          </p>
        </div>
      </div>

      <Separator />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetaField
          label="Bot username"
          value={
            channel.telegram?.botUsername ? `@${channel.telegram.botUsername}` : undefined
          }
        />
        <MetaField label="Bot ID" value={channel.telegram?.botId} />
        <MetaField
          label="Bot token"
          value={channel.hasAccessToken ? channel.telegram?.botToken : "not set"}
          copyable={false}
        />
      </div>
    </>
  );
}

function InstagramSetup({
  channel,
  links,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
}) {
  const { connect, busy } = useInstagramConnect();
  const account = channel.instagram;

  return (
    <>
      {channel.lastError ? (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Last delivery problem</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {channel.lastError}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Tabs defaultValue="account" className="min-w-0">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="qr">QR code</TabsTrigger>
          </TabsList>
          <TabsContent value="account">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              {account?.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={account.profilePictureUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  className={`flex size-12 shrink-0 items-center justify-center rounded-full text-white ${INSTAGRAM_GRADIENT}`}
                >
                  <InstagramLogo className="size-6" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {account?.name || channel.name}
                </span>
                {account ? (
                  <a
                    href={`https://instagram.com/${account.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm text-muted-foreground hover:underline"
                  >
                    @{account.username}
                  </a>
                ) : null}
                {account?.tokenExpiresAt ? (
                  <span className="text-xs text-muted-foreground">
                    Access renews automatically · good until{" "}
                    {new Date(account.tokenExpiresAt).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 bg-background"
                disabled={busy}
                onClick={() => void connect(channel.agentId, channel.name)}
              >
                {busy ? <Spinner /> : <InstagramLogo />} Reconnect
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="qr">
            <ChannelQr
              url={links.igLink}
              caption="Point a phone camera at this to open a direct message to this account in Instagram. Send anything and the front desk answers."
              unavailable="This account has no username saved. Reconnect it to fetch one."
            />
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <InfoIcon className="size-4 text-muted-foreground" />
            No messages arriving?
          </p>
          <p className="text-xs text-muted-foreground">
            In the Instagram app, open Settings {"→"} Messages and story
            replies {"→"} Message controls {"→"} Connected tools, and turn on{" "}
            <strong className="text-foreground">Allow access to messages</strong>.
            Replies are only delivered within 24 hours of the customer&apos;s
            last message.
          </p>
        </div>
      </div>
    </>
  );
}

/** The full card: everything about the channel, on the page. */
function ChannelCard({
  channel,
  links,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
}) {
  const { isWeb, live } = links;
  return (
    <Card>
      {/* One row, always: who this is, where it points, how much has come
          through it, and whether it is on. Everything that used to push those
          below the fold is now either in a tab or behind the overflow menu. */}
      <CardHeader className="gap-0">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
              live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            <ChannelGlyph type={links.kind} className="size-5" />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {channel.name}
              <Badge
                variant={
                  channel.status === "active"
                    ? "default"
                    : channel.status === "error"
                      ? "destructive"
                      : "secondary"
                }
              >
                {channel.status}
              </Badge>
              <Badge variant="outline">
                {"→"} {channel.agentName}
              </Badge>
              {channel.whatsapp?.displayPhoneNumber ? (
                <Badge variant="secondary" className="font-mono">
                  {channel.whatsapp.displayPhoneNumber}
                </Badge>
              ) : null}
              {channel.instagram ? (
                <Badge variant="secondary">@{channel.instagram.username}</Badge>
              ) : null}
              {channel.rcs?.displayPhoneNumber ? (
                <Badge variant="secondary" className="font-mono">
                  {channel.rcs.displayPhoneNumber}
                </Badge>
              ) : null}
              {channel.telegram?.botUsername ? (
                <Badge variant="secondary">@{channel.telegram.botUsername}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {channel.lastInboundAt
                ? `Last inbound message ${new Date(channel.lastInboundAt).toLocaleString()}`
                : "No inbound messages received yet."}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatTile
              icon={<ChatCircleIcon className="size-4" />}
              value={channel.messageCount}
              label="Messages"
            />
            <StatTile
              icon={<UsersIcon className="size-4" />}
              value={channel.contactCount}
              label={isWeb ? "Visitors" : "Customers"}
            />
            <ChannelControls channel={channel} links={links} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <ChannelSetup channel={channel} links={links} />
      </CardContent>
    </Card>
  );
}

/**
 * The small card, for the grid: who it is, where it points, how busy, and
 * whether it is on. The setup — embed code, callback URL, QR — opens from it,
 * since it is read once when wiring the channel up and rarely after.
 */
function ChannelTile({
  channel,
  links,
}: {
  channel: ChannelRow;
  links: ChannelLinks;
}) {
  const { isWeb, isInstagram, live } = links;
  return (
    <Card size="sm" className="flex flex-col">
      <CardHeader className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
            live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          <ChannelGlyph type={links.kind} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate" title={channel.name}>
            {channel.name}
          </CardTitle>
          <CardDescription className="truncate">
            {channel.whatsapp?.displayPhoneNumber ? (
              <span className="font-mono">
                {channel.whatsapp.displayPhoneNumber}
              </span>
            ) : channel.rcs?.displayPhoneNumber ? (
              <span className="font-mono">{channel.rcs.displayPhoneNumber}</span>
            ) : channel.instagram ? (
              `@${channel.instagram.username}`
            ) : channel.telegram?.botUsername ? (
              `@${channel.telegram.botUsername}`
            ) : isWeb ? (
              "Website widget"
            ) : (
              CHANNEL_LABEL[links.kind]
            )}
          </CardDescription>
        </div>
        <Badge
          variant={
            channel.status === "active"
              ? "default"
              : channel.status === "error"
                ? "destructive"
                : "secondary"
          }
          className="shrink-0"
        >
          {channel.status}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="truncate text-xs text-muted-foreground">
          {"→"} {channel.agentName}
        </p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ChatCircleIcon className="size-4" />
            <span className="font-semibold text-foreground tabular-nums">
              {channel.messageCount}
            </span>{" "}
            messages
          </span>
          <span className="flex items-center gap-1.5">
            <UsersIcon className="size-4" />
            <span className="font-semibold text-foreground tabular-nums">
              {channel.contactCount}
            </span>{" "}
            {isWeb ? "visitors" : "customers"}
          </span>
        </div>
        {channel.lastError ? (
          <p
            className="flex items-center gap-1.5 truncate text-xs text-destructive"
            title={channel.lastError}
          >
            <WarningIcon className="size-3.5 shrink-0" />
            {channel.lastError}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-2 border-t pt-3">
          <Dialog>
            <DialogTrigger
              render={
                <Button size="sm" variant="outline">
                  <GearIcon />{" "}
                  {isWeb ? "Embed & QR" : isInstagram ? "Account & QR" : "Setup & QR"}
                </Button>
              }
            />
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>{channel.name}</DialogTitle>
                <DialogDescription>
                  {isWeb
                    ? "Put the widget on your website, or open it on its own."
                    : isInstagram
                      ? "The connected Instagram account, and a QR code that opens a chat with it."
                      : links.kind === "telegram"
                        ? "The bot's link, and a QR code that opens a chat with it."
                        : links.kind === "rcs"
                          ? "Connect this sender with your RCS provider, or share it as a QR code."
                          : "Connect this number in Meta, or share it as a QR code."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <ChannelSetup channel={channel} links={links} />
              </div>
            </DialogContent>
          </Dialog>
          <div className="ml-auto flex items-center gap-1">
            <ChannelControls channel={channel} links={links} compact />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectButtons() {
  return (
    <>
      <ChannelDialog
        trigger={
          <Button variant="outline">
            <WhatsappLogoIcon /> Connect WhatsApp
          </Button>
        }
      />
      <ConnectInstagramButton />
      <ProviderChannelDialog
        kind="rcs"
        trigger={
          <Button variant="outline">
            <RcsLogo /> Connect RCS
          </Button>
        }
      />
      <ProviderChannelDialog
        kind="telegram"
        trigger={
          <Button variant="outline">
            <TelegramLogo /> Connect Telegram
          </Button>
        }
      />
      <WebChannelDialog
        trigger={
          <Button>
            <GlobeIcon /> Create Web Widget
          </Button>
        }
      />
    </>
  );
}

export default function ChannelsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const router = useRouter();
  const params = useSearchParams();
  const connectedParam = params.get("connected");
  const instagramError = params.get("instagram_error");
  useEffect(() => {
    if (connectedParam !== "instagram" && !instagramError) return;
    toast.add(
      instagramError
        ? {
            title: "Could not connect Instagram",
            description: instagramError,
            type: "error",
          }
        : {
            title: "Instagram connected",
            description:
              "Direct messages to this account are now answered by your agent.",
            type: "success",
          }
    );
    router.replace(`${base}/channels`);
  }, [base, connectedParam, instagramError, router]);

  const channels = useQuery(api.channels.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  // Read on the client only: this component pre-renders on the server, where
  // there is no window to ask.
  const appOrigin =
    typeof window === "undefined" ? "" : window.location.origin;

  // The webhook is served by the Convex deployment, not the Next app, so the
  // URL is public without a tunnel and the access token stays inside Convex.
  const webhookBase = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://agent.magicwebs.ai"
  ).replace(/\/$/, "");

  const hasAgents = (agents ?? []).length > 0;

  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [sort, setSort] = useState<ChannelSort>("updated");
  // Small cards by default: a page of channels is scanned for which one is
  // off or failing, and the full card's embed codes and QR codes are read
  // once, when a channel is wired up.
  const [view, setView] = useState<"grid" | "cards">("grid");

  const all = channels ?? [];
  const counts: Record<ChannelFilter, number> = {
    all: all.length,
    whatsapp: all.filter((c) => c.type === "whatsapp").length,
    instagram: all.filter((c) => c.type === "instagram").length,
    rcs: all.filter((c) => c.type === "rcs").length,
    telegram: all.filter((c) => c.type === "telegram").length,
    web: all.filter((c) => c.type === "web").length,
    // Anything not currently taking messages, whichever way it got there —
    // paused by hand or knocked into error by a failed delivery. They are the
    // same question when you open this page: what is not working?
    inactive: all.filter((c) => c.status !== "active").length,
  };

  const visible = all
    .filter((channel) =>
      filter === "all"
        ? true
        : filter === "inactive"
          ? channel.status !== "active"
          : channel.type === filter
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "busiest"
          ? b.messageCount - a.messageCount
          : b.updatedAt - a.updatedAt
    );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Channels
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            WhatsApp numbers, Instagram accounts, RCS senders, Telegram bots and
            website widgets. Each one points at an agent —
            normally the front desk, which routes each conversation on to
            whichever agent should handle it.
          </p>
        </div>
          <div className="flex flex-wrap gap-2">
            <ConnectButtons />
          </div>
      </header>

      {all.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <FilterChip
                key={option.value}
                label={option.label}
                count={counts[option.value]}
                active={filter === option.value}
                onPress={() => setFilter(option.value)}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Grid view"
                title="Grid"
                aria-pressed={view === "grid"}
                className={view === "grid" ? "bg-primary/10 text-primary" : undefined}
                onClick={() => setView("grid")}
              >
                <SquaresFourIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Card view"
                title="Cards"
                aria-pressed={view === "cards"}
                className={view === "cards" ? "bg-primary/10 text-primary" : undefined}
                onClick={() => setView("cards")}
              >
                <RowsIcon />
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    <ArrowsDownUpIcon />
                    {SORTS.find((option) => option.value === sort)?.label}
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(next) => setSort(next as ChannelSort)}
                >
                  {SORTS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : (
        <Separator />
      )}

      {!hasAgents ? (
        <Alert>
          <WarningIcon />
          <AlertTitle>Create an agent first</AlertTitle>
          <AlertDescription>
            A channel routes messages to one agent, so there has to be one to
            route to.{" "}
            <Link href={`${base}/agents`} className="underline">
              Create an agent
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {channels === undefined ? (
        <CardGridSkeleton count={2} className="lg:grid-cols-2" />
      ) : channels.length === 0 ? (
        hasAgents ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WhatsappLogoIcon />
              </EmptyMedia>
              <EmptyTitle>No channels connected</EmptyTitle>
              <EmptyDescription>
                Connect a WhatsApp number, an RCS sender or a Telegram bot, sign
                in with an Instagram business account, or put a chat widget on
                your website.
              </EmptyDescription>
            </EmptyHeader>
              <div className="flex flex-wrap justify-center gap-2">
                <ConnectButtons />
              </div>
          </Empty>
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nothing matches that filter.
            </p>
          ) : null}

          {view === "grid" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visible.map((channel) => (
                <ChannelTile
                  key={channel._id}
                  channel={channel}
                  links={channelLinks(channel, appOrigin, webhookBase)}
                />
              ))}
            </div>
          ) : (
            visible.map((channel) => (
              <ChannelCard
                key={channel._id}
                channel={channel}
                links={channelLinks(channel, appOrigin, webhookBase)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
