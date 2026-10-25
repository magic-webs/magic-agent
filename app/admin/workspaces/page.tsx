"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { SelectField } from "@/components/select-field";
import QRCode from "react-qr-code";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { copyText } from "@/components/notifications/shared";
import { CompanyLogo } from "@/components/company-logo";
import {
  InstagramLogo,
  RcsLogo,
  TelegramLogo,
  WhatsAppLogo,
} from "@/components/brand-icons";
import {
  WORKSPACE_STAGES,
  WorkspaceStageBadge,
  WorkspaceStagePicker,
  displayedStage,
} from "@/components/workspace-stage";
import {
  CurrencyPicker,
  LocalePicker,
  TimezonePicker,
} from "@/components/regional-pickers";
import { toast } from "@/components/ui/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_SETUP_OPTIONS,
  SetupPromptFields,
  buildSetupPrompt,
  type SetupOptions,
  type WorkspaceBasics,
} from "@/components/workspace-setup-prompt";
import { CardGridSkeleton, TableSkeleton } from "@/components/skeletons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  Building03Icon,
  Cancel01Icon,
  Copy01Icon,
  Globe02Icon,
  LayoutGridIcon,
  LayoutTable01Icon,
  LinkSquare02Icon,
  MagicWand01Icon,
  PlusSignIcon,
  Search01Icon,
  SparklesIcon,
  WorkHistoryIcon,
} from "@hugeicons/core-free-icons";
import { formatDistanceToNow } from "date-fns";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";

/**
 * The two ways to read the same list.
 *
 * List is the default: this is the page an administrator opens to find one
 * workspace among all of them, and a table puts four times as many on screen
 * with each one's stage and channels in columns of their own.
 * Cards are the better read when there are a dozen and you are surveying
 * rather than looking something up, which is what the page used to assume.
 */
type View = "list" | "cards";

const VIEWS = [
  { value: "list", label: "List", icon: LayoutTable01Icon },
  { value: "cards", label: "Cards", icon: LayoutGridIcon },
] as const satisfies ReadonlyArray<{
  value: View;
  label: string;
  icon: IconSvgElement;
}>;

type WorkspaceChannel = FunctionReturnType<
  typeof api.workspaces.list
>[number]["channels"][number];

const CHANNEL_KINDS = [
  {
    type: "whatsapp",
    label: "WhatsApp",
    icon: <WhatsAppLogo className="size-4 text-[#25D366]" />,
  },
  {
    type: "instagram",
    label: "Instagram",
    icon: <InstagramLogo className="size-4 text-[#E4405F]" />,
  },
  {
    type: "rcs",
    label: "RCS",
    icon: <RcsLogo className="size-4 text-[#1A73E8]" />,
  },
  {
    type: "telegram",
    label: "Telegram",
    icon: <TelegramLogo className="size-4 text-[#229ED9]" />,
  },
  {
    type: "web",
    label: "Web chat",
    icon: <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="size-4 text-sky-600" />,
  },
] as const;

function channelLink(channel: WorkspaceChannel): string | null {
  if (channel.type === "web") {
    return typeof window === "undefined"
      ? null
      : `${window.location.origin}/widget/${channel.channelKey}`;
  }
  if (channel.type === "instagram") {
    return channel.instagramUsername
      ? `https://ig.me/m/${channel.instagramUsername}`
      : null;
  }
  if (channel.type === "telegram") {
    return channel.telegramUsername ? `https://t.me/${channel.telegramUsername}` : null;
  }
  if (channel.type === "rcs") {
    return channel.phone ? `sms:+${channel.phone}` : null;
  }
  return channel.phone ? `https://wa.me/${channel.phone}` : null;
}

function ChannelLink({ channel }: { channel: WorkspaceChannel }) {
  const url = channelLink(channel);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{channel.name}</span>
        <Badge variant={channel.status === "active" ? "default" : "secondary"}>
          {channel.status}
        </Badge>
      </div>
      {url ? (
        <>
          <div className="self-center rounded-lg bg-white p-3">
            <QRCode
              value={url}
              size={160}
              level="M"
              bgColor="#ffffff"
              fgColor="#0b1c12"
            />
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {url}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(url, "Link")}
            >
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Copy
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={<a href={url} target="_blank" rel="noopener noreferrer" />}
            >
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} /> Open
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {channel.type === "whatsapp"
            ? "No display phone number saved for this channel."
            : "No link for this channel yet."}
        </p>
      )}
    </div>
  );
}

function ChannelIcons({ channels }: { channels: WorkspaceChannel[] }) {
  const groups = CHANNEL_KINDS.map((kind) => ({
    ...kind,
    channels: channels.filter((channel) => channel.type === kind.type),
  })).filter((group) => group.channels.length > 0);

  if (groups.length === 0) {
    return <span className="text-xs text-muted-foreground">None yet</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {groups.map((group) => {
        const live = group.channels.some(
          (channel) => channel.status === "active",
        );
        return (
          <Popover key={group.type}>
            <PopoverTrigger
              title={`${group.label}: ${group.channels
                .map((channel) => `${channel.name} (${channel.status})`)
                .join(", ")}`}
              className={cn(
                "inline-flex cursor-pointer items-center gap-0.5 rounded-md border px-1.5 py-1 hover:bg-muted",
                !live && "opacity-40",
              )}
            >
              {group.icon}
              {group.channels.length > 1 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {group.channels.length}
                </span>
              ) : null}
            </PopoverTrigger>
            <PopoverContent className="max-h-[70vh] overflow-y-auto">
              {group.channels.map((channel, index) => (
                <div key={channel._id} className="flex flex-col gap-2.5">
                  {index > 0 ? <Separator /> : null}
                  <ChannelLink channel={channel} />
                </div>
              ))}
            </PopoverContent>
          </Popover>
        );
      })}
    </span>
  );
}

type WorkspaceManager = FunctionReturnType<
  typeof api.workspaces.list
>[number]["managers"][number];

function Managers({ managers }: { managers: WorkspaceManager[] }) {
  if (managers.length === 0) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  const names = managers.map((manager) => manager.name).join(", ");
  return (
    <span title={names} className="block truncate text-sm">
      {names}
    </span>
  );
}

type Workspace = FunctionReturnType<typeof api.workspaces.list>[number];

const ANY = "any";

const FILTER_KEYS = ["q", "stage", "channel", "rm", "source", "status"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

function matches(workspace: Workspace, filters: Filters): boolean {
  const query = filters.q.trim().toLowerCase();
  if (
    query &&
    ![workspace.name, workspace.slug, workspace.industry, workspace.ownerName, workspace.supportEmail].some(
      (text) => text?.toLowerCase().includes(query),
    )
  ) {
    return false;
  }
  if (filters.stage && displayedStage(workspace.stage) !== filters.stage) return false;
  if (filters.channel === "none") {
    if (workspace.channels.length > 0) return false;
  } else if (filters.channel && !workspace.channels.some((channel) => channel.type === filters.channel)) {
    return false;
  }
  if (filters.rm === "none") {
    if (workspace.managers.length > 0) return false;
  } else if (filters.rm && !workspace.managers.some((manager) => manager._id === filters.rm)) {
    return false;
  }
  if (filters.source && (workspace.source ?? "team") !== filters.source) return false;
  if (filters.status && workspace.status !== filters.status) return false;
  return true;
}

function lastLogin(time: number | null): string {
  return time ? formatDistanceToNow(time, { addSuffix: true }) : "Never";
}

function CreateWorkspaceDialog() {
  const router = useRouter();
  const createWorkspace = useMutation(api.workspaces.create);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"form" | "prompt">("form");
  const [options, setOptions] = useState<SetupOptions>(DEFAULT_SETUP_OPTIONS);
  const [form, setForm] = useState<WorkspaceBasics>({
    name: "",
    tagline: "",
    industry: "",
    description: "",
    website: "",
    supportEmail: "",
    supportPhone: "",
    ownerName: "",
    address: "",
    locale: "",
    currency: "",
    timezone: "",
  });

  const copyPrompt = async () => {
    if (!form.name.trim()) {
      toast.add({ title: "A company name is required", type: "error" });
      return;
    }
    try {
      await navigator.clipboard.writeText(buildSetupPrompt(form, options));
      toast.add({ title: "Prompt copied", type: "success" });
    } catch {
      toast.add({
        title: "Copy failed",
        description: "Select the prompt and copy it manually.",
        type: "error",
      });
    }
  };

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.add({ title: "A workspace name is required", type: "error" });
      return;
    }
    if (!form.locale || !form.currency || !form.timezone) {
      toast.add({
        title: "Pick a locale, currency and timezone",
        type: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const { slug } = await createWorkspace({
        name: form.name,
        tagline: form.tagline || undefined,
        industry: form.industry || undefined,
        description: form.description || undefined,
        website: form.website || undefined,
        supportEmail: form.supportEmail || undefined,
        supportPhone: form.supportPhone || undefined,
        ownerName: form.ownerName || undefined,
        address: form.address || undefined,
        locale: form.locale,
        currency: form.currency,
        timezone: form.timezone,
        facts: [],
      });
      toast.add({ title: `${form.name} created`, type: "success" });
      setOpen(false);
      router.push(`/w/${slug}`);
    } catch (error) {
      toast.add({
        title: "Could not create the workspace",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New workspace
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            A workspace is one company or project. Its agents, knowledge,
            catalogue, orders and channels all live inside it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "form" | "prompt")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="form">
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Create now
              </TabsTrigger>
              <TabsTrigger value="prompt">
                <HugeiconsIcon icon={MagicWand01Icon} strokeWidth={2} /> Setup prompt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prompt" className="pt-3">
              <SetupPromptFields
                basics={form}
                setBasic={set}
                options={options}
                setOptions={setOptions}
              />
            </TabsContent>

            <TabsContent value="form" className="pt-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ws-name">Company or project name</Label>
                  <Input
                    id="ws-name"
                    value={form.name}
                    placeholder="Company or project name"
                    onChange={(event) => set("name")(event.target.value)}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-tagline">Tagline</Label>
                    <Input
                      id="ws-tagline"
                      value={form.tagline}
                      placeholder="A short line on what the company offers"
                      onChange={(event) => set("tagline")(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-industry">Industry</Label>
                    <Input
                      id="ws-industry"
                      value={form.industry}
                      placeholder="The industry the company works in"
                      onChange={(event) => set("industry")(event.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ws-description">
                    What the business does
                    <span className="ml-1 font-normal text-muted-foreground">
                      — agents are grounded in this
                    </span>
                  </Label>
                  <Textarea
                    id="ws-description"
                    rows={3}
                    value={form.description}
                    placeholder="What the company sells, who its customers are and how it works with them"
                    onChange={(event) => set("description")(event.target.value)}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-website">Website</Label>
                    <Input
                      id="ws-website"
                      value={form.website}
                      placeholder="Website address"
                      onChange={(event) => set("website")(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ws-email">Support email</Label>
                    <Input
                      id="ws-email"
                      value={form.supportEmail}
                      placeholder="Email address"
                      onChange={(event) =>
                        set("supportEmail")(event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="ws-locale">Locale</Label>
                    <LocalePicker
                      id="ws-locale"
                      value={form.locale}
                      onValueChange={set("locale")}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="ws-currency">Currency</Label>
                    <CurrencyPicker
                      id="ws-currency"
                      value={form.currency}
                      onValueChange={set("currency")}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="ws-tz">Timezone</Label>
                    <TimezonePicker
                      id="ws-tz"
                      value={form.timezone}
                      onValueChange={set("timezone")}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {mode === "prompt" ? (
            <Button onClick={copyPrompt}>
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Copy prompt
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />} Create workspace
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspacesDirectory() {
  // The layout has already established that this is an administrator, so the
  // query is asked outright rather than skipped on a role check.
  const workspaces = useQuery(api.workspaces.list, {});
  const seedDemo = useMutation(api.workspaces.seedDemo);
  const { canModify, me } = useSession();
  const manages = canModify("workspaces");
  const createsWorkspaces = manages && !(me?.role === "admin" && me.scoped);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [seeding, setSeeding] = useState(false);
  const [view, setView] = useState<View>("list");
  // Its own state so the box keeps up with typing; the URL follows it, as it
  // does the other filters, so they survive opening a workspace and coming back.
  const [query, setQuery] = useState(() => params.get("q") ?? "");

  const filters = {
    ...(Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as Filters),
    q: query,
  };
  const filtering = FILTER_KEYS.some((key) => filters[key]);
  const setFilter = (key: keyof Filters, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== ANY) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
  };
  const clearFilters = () => {
    setQuery("");
    window.history.replaceState(null, "", pathname);
  };

  const shown = workspaces?.filter((workspace) => matches(workspace, filters)) ?? [];
  const managers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const workspace of workspaces ?? []) {
      for (const manager of workspace.managers) byId.set(manager._id, manager.name);
    }
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [workspaces]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Workspaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One company or project each, with its own agents and data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Icons only, each carrying its name as a tooltip and an
              aria-label: two labelled buttons plus the create button would
              run this row wider than the heading beside it. */}
          <ToggleGroup
            value={[view]}
            onValueChange={(value) => {
              const next = value[0] as View | undefined;
              if (next) setView(next);
            }}
            className="rounded-lg border p-0.5"
          >
            {VIEWS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                title={`${option.label} view`}
                aria-label={`${option.label} view`}
              >
                <HugeiconsIcon icon={option.icon} strokeWidth={2} className="size-4" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {createsWorkspaces ? <CreateWorkspaceDialog /> : null}
        </div>
      </header>

      {workspaces === undefined ? (
        view === "cards" ? (
          <CardGridSkeleton
            count={4}
            className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          />
        ) : (
          <TableSkeleton rows={8} columns={7} />
        )
      ) : workspaces.length === 0 && !createsWorkspaces ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No workspaces assigned</EmptyTitle>
            <EmptyDescription>
              An administrator has not given you access to any workspace yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : workspaces.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No workspaces yet</EmptyTitle>
            <EmptyDescription>
              Create one for the company or project you want a bot for, or start
              from a sample workspace to see how it fits together.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              <CreateWorkspaceDialog />
              <Button
                variant="outline"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  try {
                    const { slug } = await seedDemo({});
                    router.push(`/w/${slug}`);
                  } finally {
                    setSeeding(false);
                  }
                }}
              >
                {seeding ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />} Start from a sample
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                placeholder="Find a workspace"
                aria-label="Find a workspace"
                className="pl-8"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setFilter("q", event.target.value);
                }}
              />
            </div>
            <SelectField
              aria-label="Stage"
              className="min-w-36"
              value={filters.stage || ANY}
              onValueChange={(value) => setFilter("stage", value)}
              options={[
                { value: ANY, label: "Any stage" },
                ...WORKSPACE_STAGES.map(({ value, label }) => ({ value, label })),
                { value: "custom", label: "Custom" },
              ]}
            />
            <SelectField
              aria-label="Channel"
              className="min-w-36"
              value={filters.channel || ANY}
              onValueChange={(value) => setFilter("channel", value)}
              options={[
                { value: ANY, label: "Any channel" },
                ...CHANNEL_KINDS.map(({ type, label }) => ({ value: type, label })),
                { value: "none", label: "No channels" },
              ]}
            />
            <SelectField
              aria-label="RM"
              className="min-w-32"
              value={filters.rm || ANY}
              onValueChange={(value) => setFilter("rm", value)}
              options={[
                { value: ANY, label: "Any RM" },
                { value: "none", label: "Unassigned" },
                ...managers.map(([value, label]) => ({ value, label })),
              ]}
            />
            <SelectField
              aria-label="Source"
              className="min-w-36"
              value={filters.source || ANY}
              onValueChange={(value) => setFilter("source", value)}
              options={[
                { value: ANY, label: "Any source" },
                { value: "signup", label: "Website sign-up" },
                { value: "team", label: "Added by the team" },
              ]}
            />
            <SelectField
              aria-label="Status"
              className="min-w-32"
              value={filters.status || ANY}
              onValueChange={(value) => setFilter("status", value)}
              options={[
                { value: ANY, label: "Any status" },
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
            />
            {filtering ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Clear
              </Button>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {shown.length === workspaces.length
                ? `${workspaces.length} workspaces`
                : `${shown.length} of ${workspaces.length}`}
            </span>
          </div>

          {shown.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building03Icon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>No workspaces match</EmptyTitle>
                <EmptyDescription>
                  Nothing fits every filter at once. Loosen one, or clear them all.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={clearFilters}>
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          ) : view === "list" ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-44">Workspace</TableHead>
                    <TableHead className="min-w-36">Stage</TableHead>
                    <TableHead className="hidden sm:table-cell min-w-32">
                      Channels
                    </TableHead>
                    <TableHead className="hidden md:table-cell min-w-32">
                      RM
                    </TableHead>
                    <TableHead className="hidden lg:table-cell min-w-28">
                      Last login
                    </TableHead>
                    <TableHead className="hidden xl:table-cell min-w-24">
                      Created
                    </TableHead>
                    <TableHead className="w-44" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((workspace) => (
                    <TableRow key={workspace._id}>
                      <TableCell className="max-w-56 min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <CompanyLogo
                            src={workspace.logoSrc}
                            className="size-7 rounded-md"
                          />
                          <span className="truncate font-medium">
                            {workspace.name}
                          </span>
                          {workspace.status === "archived" ? (
                            <Badge variant="secondary">archived</Badge>
                          ) : null}
                          {workspace.source === "signup" ? (
                            <Badge variant="outline">sign-up</Badge>
                          ) : null}
                        </span>
                      </TableCell>

                      <TableCell>
                        {manages ? (
                          <WorkspaceStagePicker
                            workspaceId={workspace._id}
                            name={workspace.name}
                            stage={workspace.stage}
                            label={workspace.stageLabel}
                          />
                        ) : (
                          <WorkspaceStageBadge
                            stage={workspace.stage}
                            label={workspace.stageLabel}
                          />
                        )}
                      </TableCell>

                      <TableCell className="hidden sm:table-cell">
                        <ChannelIcons channels={workspace.channels} />
                      </TableCell>

                      <TableCell className="hidden md:table-cell max-w-44">
                        <Managers managers={workspace.managers} />
                      </TableCell>

                      <TableCell className="hidden lg:table-cell text-xs whitespace-nowrap text-muted-foreground">
                        {lastLogin(workspace.lastLoginAt)}
                      </TableCell>

                      <TableCell className="hidden xl:table-cell text-xs whitespace-nowrap text-muted-foreground">
                        {formatDistanceToNow(workspace.createdAt, {
                          addSuffix: true,
                        })}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            nativeButton={false}
                            render={
                              <Link
                                href={`/admin/activity?workspace=${workspace._id}`}
                              />
                            }
                          >
                            <HugeiconsIcon icon={WorkHistoryIcon} strokeWidth={2} /> Activity
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            nativeButton={false}
                            render={<Link href={`/w/${workspace.slug}`} />}
                          >
                            Open <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((workspace) => (
                <Card key={workspace._id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CompanyLogo src={workspace.logoSrc} className="size-9" />
                      <span className="min-w-0 flex-1 truncate">
                        {workspace.name}
                      </span>
                      {workspace.status === "archived" ? (
                        <Badge variant="secondary">archived</Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      {workspace.tagline ||
                        workspace.description ||
                        workspace.industry ||
                        "No description yet"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex flex-col gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      /{workspace.slug}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <WorkspaceStageBadge
                        stage={workspace.stage}
                        label={workspace.stageLabel}
                      />
                      <ChannelIcons channels={workspace.channels} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">
                        RM:{" "}
                        {workspace.managers.length
                          ? workspace.managers.map((m) => m.name).join(", ")
                          : "Unassigned"}
                      </span>
                      <span className="shrink-0">
                        Login {lastLogin(workspace.lastLoginAt).toLowerCase()}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-end gap-1">
                      <div className="flex items-center gap-1">
                        <Button
                          size="lg"
                          variant="ghost"
                          nativeButton={false}
                          aria-label="Activity"
                          render={
                            <Link
                              href={`/admin/activity?workspace=${workspace._id}`}
                            />
                          }
                        >
                          <HugeiconsIcon icon={WorkHistoryIcon} strokeWidth={2} />
                        </Button>
                        <Button
                          size="lg"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/w/${workspace.slug}`} />}
                        >
                          Open <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminWorkspacesPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={7} />}>
      <WorkspacesDirectory />
    </Suspense>
  );
}
