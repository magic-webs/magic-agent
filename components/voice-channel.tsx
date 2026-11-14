"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiVoiceIcon, Copy01Icon, InformationCircleIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/select-field";
import { ChannelQr } from "@/components/channel-qr";
import { ORB_STYLES, VoiceOrb, type OrbState } from "@/components/voice-orb";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { VOICES } from "@/convex/lib/voices";

type Settings = NonNullable<Doc<"channels">["voiceWidget"]>;
type Position = Settings["position"];
type Size = Settings["size"];

export const DEFAULT_VOICE_SETTINGS: Settings = {
  style: "orb",
  position: "bottom-right",
  size: "medium",
  colors: ["#7c3aed", "#06b6d4"],
  captions: true,
};

const POSITIONS: { value: Position; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
];

const SIZES: { value: Size; label: string; preview: number }[] = [
  { value: "small", label: "Small", preview: 44 },
  { value: "medium", label: "Medium", preview: 56 },
  { value: "large", label: "Large", preview: 72 },
];

const PALETTES: { name: string; colors: string[] }[] = [
  { name: "Aurora", colors: ["#7c3aed", "#06b6d4"] },
  { name: "Ocean", colors: ["#2563eb", "#22d3ee"] },
  { name: "Sunset", colors: ["#f97316", "#db2777"] },
  { name: "Mint", colors: ["#10b981", "#84cc16"] },
  { name: "Rose", colors: ["#e11d48", "#a855f7"] },
  { name: "Gold", colors: ["#f59e0b", "#ef4444"] },
];

type Form = {
  name: string;
  agentId: string;
  settings: Settings;
};

function PlacementPreview({ settings }: { settings: Settings }) {
  const size = SIZES.find((option) => option.value === settings.size)!.preview;
  const [vertical, horizontal] = settings.position.split("-");
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-red-400" />
        <span className="size-2 rounded-full bg-amber-400" />
        <span className="size-2 rounded-full bg-green-400" />
        <span className="ml-2 h-4 flex-1 rounded bg-background" />
      </div>
      <div className="relative h-56 bg-[linear-gradient(180deg,var(--muted)_0,transparent_40%)]">
        <div className="flex flex-col gap-2 p-5 opacity-60">
          <span className="h-3 w-1/3 rounded bg-muted-foreground/25" />
          <span className="h-2 w-2/3 rounded bg-muted-foreground/15" />
          <span className="h-2 w-1/2 rounded bg-muted-foreground/15" />
          <span className="mt-3 h-16 w-full rounded-lg bg-muted-foreground/10" />
        </div>
        <div
          className={cn(
            "absolute transition-all duration-300",
            vertical === "top" ? "top-1" : "bottom-1",
            horizontal === "left" && "left-1",
            horizontal === "right" && "right-1",
            horizontal === "center" && "left-1/2 -translate-x-1/2"
          )}
        >
          <VoiceOrb style={settings.style} colors={settings.colors} state="idle" size={size} />
        </div>
      </div>
    </div>
  );
}

const PREVIEW_STATES: { value: OrbState; label: string }[] = [
  { value: "idle", label: "Idle" },
  { value: "listening", label: "Listening" },
  { value: "thinking", label: "Thinking" },
  { value: "speaking", label: "Speaking" },
];

function demoVolume() {
  const t = performance.now() / 1000;
  return Math.min(1, Math.max(0, 0.45 + 0.3 * Math.sin(t * 5.3) * Math.sin(t * 1.7 + 0.4)));
}

function StylePicker({
  value,
  colors,
  onChange,
}: {
  value: Settings["style"];
  colors: string[];
  onChange: (style: NonNullable<Settings["style"]>) => void;
}) {
  const [state, setState] = useState<OrbState>("idle");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Animation style</Label>
        <div className="flex gap-0.5 rounded-lg border p-0.5">
          {PREVIEW_STATES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={state === option.value}
              onClick={() => setState(option.value)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                state === option.value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label="Animation style" className="grid grid-cols-3 gap-2">
        {ORB_STYLES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              value === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            )}
          >
            <VoiceOrb
              style={option.value}
              colors={colors}
              state={state}
              size={72}
              getInputVolume={demoVolume}
              getOutputVolume={demoVolume}
            />
            <span className="text-xs font-medium">{option.label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const AGENT_VOICE = "agent";

export function VoicePicker({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string | undefined;
  onChange: (voiceId: string | undefined) => void;
}) {
  const preview = useAction(api.voice.previewVoice);
  const [playing, setPlaying] = useState(false);
  const agents = useQuery(api.agents.listByWorkspace, { workspaceId: useWorkspace()._id });
  const agent = agents?.find((a) => a._id === agentId);
  const sampleVoice = value ?? agent?.voiceId ?? (agent?.gender === "male" ? "JBFqnCBsd6RMkjVDRZzb" : "21m00Tcm4TlvDq8ikWAM");

  const play = async () => {
    if (!agentId) return;
    setPlaying(true);
    try {
      const { url } = await preview({ agentId: agentId as Id<"agents">, voiceId: sampleVoice });
      const audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      await audio.play();
    } catch (error) {
      setPlaying(false);
      toast.add({ title: "Could not play the sample", description: friendlyError(error), type: "error" });
    }
  };

  const options = [
    { value: AGENT_VOICE, label: "Agent's own voice (set on each agent)" },
    ...(["female", "male"] as const).flatMap((gender) =>
      VOICES.filter((voice) => voice.gender === gender).map((voice) => ({
        value: voice.id,
        label: `${voice.name} · ${gender === "female" ? "Female" : "Male"}, ${voice.accent}`,
      }))
    ),
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="v-voice">Voice</Label>
      <div className="flex items-center gap-2">
        <SelectField
          id="v-voice"
          className="w-full"
          value={value ?? AGENT_VOICE}
          onValueChange={(next) => onChange(next === AGENT_VOICE ? undefined : next)}
          options={options}
        />
        <Button variant="outline" disabled={playing || !agentId} onClick={() => void play()}>
          {playing ? <Spinner /> : <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />}
          Preview
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {value
          ? "The whole call uses this voice, even after the front desk hands over to another agent."
          : "Each agent speaks in the voice chosen on its Voice card."}
      </p>
    </div>
  );
}

export function VoiceChannelDialog({
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  channelId?: Id<"channels">;
  initial?: Form;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, { workspaceId: workspace._id });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(
    initial ?? { name: "AI voice", agentId: "", settings: DEFAULT_VOICE_SETTINGS }
  );

  const sortedAgents = [...(agents ?? [])].sort((a, b) =>
    a.kind === "router" ? -1 : b.kind === "router" ? 1 : 0
  );
  const agentId = form.agentId || sortedAgents[0]?._id || "";
  const settings = form.settings;
  const setSettings = (patch: Partial<Settings>) =>
    setForm((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));

  const submit = async () => {
    if (!agentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const voiceWidget = {
        ...settings,
        greeting: settings.greeting?.trim() || undefined,
      };
      if (channelId) {
        await updateChannel({
          channelId,
          name: form.name,
          agentId: agentId as Id<"agents">,
          voiceWidget,
        });
        toast.add({ title: "Voice widget updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: agentId as Id<"agents">,
          type: "voice",
          name: form.name,
          voiceWidget,
        });
        toast.add({
          title: "Voice widget created",
          description: "Copy its embed code onto your website.",
          type: "success",
        });
      }
      setOpen(false);
    } catch (error) {
      toast.add({ title: "Save failed", description: friendlyError(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{channelId ? "Edit AI voice widget" : "Create an AI voice widget"}</DialogTitle>
          <DialogDescription>
            A glowing sphere on your website. Visitors tap it and talk to your
            agent out loud, with no chat window.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-5 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-name">Widget name</Label>
              <Input
                id="v-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-agent">Agent that answers</Label>
              <SelectField
                id="v-agent"
                className="w-full"
                value={agentId}
                placeholder="No agents yet"
                onValueChange={(next) => setForm((prev) => ({ ...prev, agentId: next }))}
                options={sortedAgents.map((agent) => ({
                  value: agent._id,
                  label:
                    agent.kind === "router"
                      ? `${agent.botName} (front desk)`
                      : `${agent.botName} (${agent.name})`,
                }))}
              />
            </div>

            <VoicePicker
              agentId={agentId}
              value={settings.voiceId}
              onChange={(voiceId) => setSettings({ voiceId })}
            />

            <StylePicker
              value={settings.style ?? "orb"}
              colors={settings.colors}
              onChange={(style) => setSettings({ style })}
            />

            <div className="flex flex-col gap-1.5">
              <Label>Position on the page</Label>
              <div role="radiogroup" aria-label="Position" className="grid grid-cols-3 gap-1.5">
                {POSITIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.position === option.value}
                    onClick={() => setSettings({ position: option.value })}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      settings.position === option.value
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted/50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Size</Label>
              <div role="radiogroup" aria-label="Size" className="grid grid-cols-3 gap-1.5">
                {SIZES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.size === option.value}
                    onClick={() => setSettings({ size: option.value })}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      settings.size === option.value
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted/50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Colours</Label>
              <div className="flex flex-wrap items-center gap-2">
                {PALETTES.map((palette) => {
                  const chosen = palette.colors.join() === settings.colors.join();
                  return (
                    <button
                      key={palette.name}
                      type="button"
                      title={palette.name}
                      aria-label={palette.name}
                      aria-pressed={chosen}
                      onClick={() => setSettings({ colors: palette.colors })}
                      style={{ background: `linear-gradient(135deg, ${palette.colors.join(", ")})` }}
                      className={cn(
                        "size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        chosen && "ring-2 ring-primary"
                      )}
                    />
                  );
                })}
                <span className="mx-1 h-5 w-px bg-border" />
                {[0, 1].map((index) => (
                  <input
                    key={index}
                    type="color"
                    aria-label={index === 0 ? "Main colour" : "Second colour"}
                    value={settings.colors[index] ?? settings.colors[0]}
                    onChange={(event) => {
                      const colors = [...settings.colors];
                      colors[index] = event.target.value;
                      setSettings({ colors: colors.slice(0, 2) });
                    }}
                    className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-greeting">Greeting</Label>
              <Textarea
                id="v-greeting"
                rows={2}
                maxLength={300}
                placeholder="Leave empty to use the agent's own greeting."
                value={settings.greeting ?? ""}
                onChange={(event) => setSettings({ greeting: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Said out loud the first time a visitor taps the sphere.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="v-captions">Show captions</Label>
                <p className="text-xs text-muted-foreground">
                  A small bubble with what was said, next to the sphere.
                </p>
              </div>
              <Switch
                id="v-captions"
                checked={settings.captions}
                onCheckedChange={(captions) => setSettings({ captions })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Preview</Label>
            <PlacementPreview settings={settings} />
            <p className="text-xs text-muted-foreground">
              The sphere gently moves while idle, follows the visitor&apos;s
              voice while listening, shimmers while thinking and pulses with
              the agent&apos;s voice while speaking.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} />}
            {channelId ? "Save changes" : "Create voice widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${label} copied`, type: "success" });
  } catch {
    toast.add({ title: "Copy failed", description: "Select the text and copy it manually.", type: "error" });
  }
}

function Copyable({ value, label, hint }: { value: string; label: string; hint: string }) {
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
          onClick={() => void copy(value, label)}
        >
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function VoiceSetup({
  settings = DEFAULT_VOICE_SETTINGS,
  embedCode,
  pageUrl,
}: {
  settings?: Settings;
  embedCode: string;
  pageUrl: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Tabs defaultValue="embed" className="min-w-0">
        <TabsList>
          <TabsTrigger value="embed">Embed code</TabsTrigger>
          <TabsTrigger value="link">Direct link</TabsTrigger>
          <TabsTrigger value="qr">QR code</TabsTrigger>
        </TabsList>
        <TabsContent value="embed">
          <Copyable
            value={embedCode}
            label="Embed code"
            hint="Paste it once, anywhere before the closing </body> tag. The website must be on https for the microphone to work."
          />
        </TabsContent>
        <TabsContent value="link">
          <Copyable
            value={pageUrl}
            label="Direct link"
            hint="The sphere on its own page, handy for trying it out."
          />
        </TabsContent>
        <TabsContent value="qr">
          <ChannelQr
            url={pageUrl}
            caption="Point a phone camera at this to talk to the agent on the handset."
          />
        </TabsContent>
      </Tabs>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
          What your visitors see
        </p>
        <div className="flex items-center gap-3">
          <VoiceOrb style={settings.style} colors={settings.colors} state="idle" size={56} />
          <p className="text-xs text-muted-foreground">
            A sphere at the {POSITIONS.find((p) => p.value === settings.position)?.label.toLowerCase()} of
            the page. Tap to talk, tap again to end. Change the position on
            one page by adding <code className="font-mono">data-position=&quot;top-left&quot;</code> to
            the script tag.
          </p>
        </div>
      </div>
    </div>
  );
}
