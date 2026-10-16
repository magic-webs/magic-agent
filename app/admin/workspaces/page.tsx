"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { WorkspaceAccessDialog } from "@/components/workspace-access";
import { CompanyLogo } from "@/components/company-logo";
import { InstagramLogo, WhatsAppLogo } from "@/components/brand-icons";
import {
  WorkspaceStageBadge,
  WorkspaceStagePicker,
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
import {
  BuildingsIcon,
  CardsThreeIcon,
  PlusIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  GlobeIcon,
  MagicWandIcon,
  SparkleIcon,
  TableIcon,
  type Icon,
} from "@phosphor-icons/react";
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
  { value: "list", label: "List", icon: TableIcon },
  { value: "cards", label: "Cards", icon: CardsThreeIcon },
] as const satisfies ReadonlyArray<{
  value: View;
  label: string;
  icon: Icon;
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
    type: "web",
    label: "Web chat",
    icon: <GlobeIcon className="size-4 text-sky-600" />,
  },
] as const;

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
          <span
            key={group.type}
            title={`${group.label}: ${group.channels
              .map((channel) => `${channel.name} (${channel.status})`)
              .join(", ")}`}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-1",
              !live && "opacity-40",
            )}
          >
            {group.icon}
            {group.channels.length > 1 ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {group.channels.length}
              </span>
            ) : null}
          </span>
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
            <PlusIcon /> New workspace
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
                <PlusIcon /> Create now
              </TabsTrigger>
              <TabsTrigger value="prompt">
                <MagicWandIcon /> Setup prompt
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
              <CopyIcon /> Copy prompt
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Create workspace
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminWorkspacesPage() {
  // The layout has already established that this is an administrator, so the
  // query is asked outright rather than skipped on a role check.
  const workspaces = useQuery(api.workspaces.list, {});
  const seedDemo = useMutation(api.workspaces.seedDemo);
  const { isAdmin } = useSession();
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [view, setView] = useState<View>("list");

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
                <option.icon className="size-4" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {isAdmin ? <CreateWorkspaceDialog /> : null}
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
      ) : workspaces.length === 0 && !isAdmin ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon />
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
              <BuildingsIcon />
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
                {seeding ? <Spinner /> : <SparkleIcon />} Start from a sample
              </Button>
            </div>
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
              {workspaces.map((workspace) => (
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
                    </span>
                  </TableCell>

                  <TableCell>
                    {isAdmin ? (
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
                      {isAdmin ? (
                        <WorkspaceAccessDialog
                          workspaceId={workspace._id}
                          name={workspace.name}
                          slug={workspace.slug}
                        />
                      ) : null}
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
                        <ClockCounterClockwiseIcon /> Activity
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/w/${workspace.slug}`} />}
                      >
                        Open <ArrowRightIcon />
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
          {workspaces.map((workspace) => (
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
                <div className="flex items-center justify-between gap-1">
                  {isAdmin ? (
                    <WorkspaceAccessDialog
                      workspaceId={workspace._id}
                      name={workspace.name}
                      slug={workspace.slug}
                    />
                  ) : (
                    <span />
                  )}
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
                      <ClockCounterClockwiseIcon />
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`/w/${workspace.slug}`} />}
                    >
                      Open <ArrowRightIcon />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
