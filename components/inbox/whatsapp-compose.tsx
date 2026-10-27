"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Outbound } from "@/convex/lib/whatsappSend";
import { RichMessage } from "@/components/rich-message";
import { SelectField } from "@/components/select-field";
import { putFile } from "@/lib/upload";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ContactIcon,
  Delete02Icon,
  File01Icon,
  Image01Icon,
  LeftToRightListBulletIcon,
  LinkSquare02Icon,
  Location01Icon,
  Mic01Icon,
  Navigation03Icon,
  Note01Icon,
  PlusSignIcon,
  RefreshIcon,
  CursorPointer01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

export type ComposeKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "location"
  | "contact"
  | "buttons"
  | "list"
  | "cta_url"
  | "request_location"
  | "template";

type Composed = FunctionArgs<typeof api.inboxCompose.sendManualRich>["message"];
type Template = FunctionReturnType<typeof api.inboxCompose.templatesForThread>[number];
type MediaKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

/** What WhatsApp accepts per attachment, as its Cloud API documents it. */
const MEDIA_RULES: Record<MediaKind, { accept: string; types: string[] | null; maxBytes: number; label: string }> = {
  image: { accept: "image/jpeg,image/png", types: ["image/jpeg", "image/png"], maxBytes: 5 * MB, label: "JPG or PNG, up to 5 MB" },
  video: { accept: "video/mp4,video/3gpp", types: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB, label: "MP4 or 3GP, up to 16 MB" },
  audio: {
    accept: "audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg",
    types: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
    maxBytes: 16 * MB,
    label: "MP3, AAC, M4A, AMR or OGG, up to 16 MB",
  },
  document: { accept: "*/*", types: null, maxBytes: 100 * MB, label: "Any file, up to 100 MB" },
};

const HEADER_MEDIA: Record<string, MediaKind> = { IMAGE: "image", VIDEO: "video", DOCUMENT: "document" };

const MENU: Array<{ group: string; items: Array<{ kind: ComposeKind; label: string; icon: typeof Image01Icon }> }> = [
  {
    group: "Attach",
    items: [
      { kind: "image", label: "Photo", icon: Image01Icon },
      { kind: "video", label: "Video", icon: Video01Icon },
      { kind: "document", label: "Document", icon: File01Icon },
      { kind: "audio", label: "Audio", icon: Mic01Icon },
    ],
  },
  {
    group: "Share",
    items: [
      { kind: "location", label: "Location", icon: Location01Icon },
      { kind: "contact", label: "Contact card", icon: ContactIcon },
    ],
  },
  {
    group: "Interactive",
    items: [
      { kind: "buttons", label: "Reply buttons", icon: CursorPointer01Icon },
      { kind: "list", label: "List menu", icon: LeftToRightListBulletIcon },
      { kind: "cta_url", label: "Link button", icon: LinkSquare02Icon },
      { kind: "request_location", label: "Ask for location", icon: Navigation03Icon },
    ],
  },
  { group: "Approved", items: [{ kind: "template", label: "Template message", icon: Note01Icon }] },
];

const TITLES: Record<ComposeKind, string> = {
  image: "Send a photo",
  video: "Send a video",
  audio: "Send audio",
  document: "Send a document",
  location: "Share a location",
  contact: "Share a contact card",
  buttons: "Send reply buttons",
  list: "Send a list menu",
  cta_url: "Send a link button",
  request_location: "Ask for their location",
  template: "Send a template",
};

export function ComposeMenu({ onPick }: { onPick: (kind: ComposeKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Attach or send something else"
            title="Media, location, buttons, lists, templates…"
          />
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52">
        {MENU.map((section, index) => (
          <DropdownMenuGroup key={section.group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{section.group}</DropdownMenuLabel>
            {section.items.map((item) => (
              <DropdownMenuItem key={item.kind} onClick={() => onPick(item.kind)}>
                <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Counted({
  value,
  onChange,
  max,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (value: string) => void;
  max: number;
  placeholder?: string;
  multiline?: boolean;
}) {
  const props = {
    value,
    placeholder,
    maxLength: max,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return (
    <div className="relative">
      {multiline ? <Textarea {...props} className="min-h-20 pr-12" /> : <Input {...props} className="pr-12" />}
      <span className="pointer-events-none absolute right-2 bottom-1.5 text-[10px] text-muted-foreground tabular-nums">
        {value.length}/{max}
      </span>
    </div>
  );
}

type Upload = { key: string; url: string; name: string; type: string };

function FilePick({
  kind,
  conversationId,
  value,
  onChange,
}: {
  kind: MediaKind;
  conversationId: Id<"conversations">;
  value: Upload | null;
  onChange: (upload: Upload | null) => void;
}) {
  const generateUploadUrl = useMutation(api.inboxCompose.generateUploadUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const rules = MEDIA_RULES[kind];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (rules.types && !rules.types.includes(file.type)) {
      toast.add({ title: "Not a supported file", description: rules.label, type: "error" });
      return;
    }
    if (file.size > rules.maxBytes) {
      toast.add({ title: "File too large", description: rules.label, type: "error" });
      return;
    }
    setBusy(true);
    try {
      const key = await putFile(await generateUploadUrl({ conversationId }), file);
      onChange({ key, url: URL.createObjectURL(file), name: file.name, type: file.type || "application/octet-stream" });
    } catch (error) {
      toast.add({ title: "Upload failed", description: friendlyError(error), type: "error" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={input}
        type="file"
        accept={rules.accept}
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : null}
        {value ? "Replace file" : "Choose file"}
      </Button>
      {value ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{value.name}</span>
          <Button size="icon-xs" variant="ghost" aria-label="Remove file" onClick={() => onChange(null)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{rules.label}</span>
      )}
    </div>
  );
}

const fillVariables = (text: string, values: Record<string, string>, prefix: string) =>
  text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, variable: string) => values[`${prefix}:${variable}`]?.trim() || match);

/**
 * Keyed by the caller on every open, so each one starts on an empty form.
 *
 * Everything WhatsApp delivers besides typed prose, sent by hand from a
 * thread: media, a pin, a contact card, the interactive messages, and the
 * approved templates — the one thing that still arrives after the 24-hour
 * window has closed.
 */
export function ComposeDialog({
  kind,
  onClose,
  conversationId,
  workspaceId,
  teamMemberId,
  pauseMinutes,
  windowClosed,
}: {
  kind: ComposeKind | null;
  onClose: () => void;
  conversationId: Id<"conversations">;
  workspaceId: Id<"workspaces">;
  teamMemberId?: Id<"teamMembers">;
  pauseMinutes: number;
  windowClosed: boolean;
}) {
  const send = useAction(api.inboxCompose.sendManualRich);
  const syncTemplates = useAction(api.notificationsSend.syncWhatsAppTemplates);
  const templates = useQuery(
    api.inboxCompose.templatesForThread,
    kind === "template" ? { conversationId } : "skip"
  );

  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [caption, setCaption] = useState("");
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState(["", "", ""]);
  const [listButton, setListButton] = useState("View options");
  const [sections, setSections] = useState([{ title: "", rows: [{ title: "", description: "" }] }]);
  const [linkLabel, setLinkLabel] = useState("");
  const [link, setLink] = useState("");
  const [place, setPlace] = useState({ latitude: "", longitude: "", name: "", address: "" });
  const [person, setPerson] = useState({ name: "", phone: "", email: "", company: "" });
  const [templateId, setTemplateId] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});


  const sendable = (templates ?? []).filter((template) => template.sendable);
  const template: Template | undefined =
    sendable.find((one) => one._id === templateId) ?? sendable[0];
  const headerMediaKind = template?.header ? HEADER_MEDIA[template.header.format] : undefined;

  const rowCount = sections.reduce((sum, section) => sum + section.rows.length, 0);

  const composed = ((): { message: Composed; preview: Outbound } | string => {
    switch (kind) {
      case null:
        return "";
      case "image":
      case "video":
      case "audio":
      case "document":
        if (!upload) return "Choose a file to send.";
        return {
          message: {
            kind: "media",
            media: kind,
            key: upload.key,
            mimeType: upload.type,
            ...(kind !== "audio" && caption.trim() ? { caption } : {}),
            ...(kind === "document" ? { filename: upload.name } : {}),
          },
          preview: {
            kind: "media",
            media: kind,
            source: { link: upload.url },
            caption: kind !== "audio" ? caption : undefined,
            filename: upload.name,
          },
        };
      case "location": {
        const latitude = Number(place.latitude);
        const longitude = Number(place.longitude);
        if (!place.latitude.trim() || !place.longitude.trim() || Number.isNaN(latitude) || Number.isNaN(longitude)) {
          return "Enter the latitude and longitude.";
        }
        const shared = {
          latitude,
          longitude,
          name: place.name.trim() || undefined,
          address: place.address.trim() || undefined,
        };
        return { message: { kind: "location", ...shared }, preview: { kind: "location", ...shared } };
      }
      case "contact":
        if (!person.name.trim() || !person.phone.trim()) return "A contact card needs a name and a phone number.";
        return {
          message: {
            kind: "contact",
            name: person.name,
            phone: person.phone,
            ...(person.email.trim() ? { email: person.email } : {}),
            ...(person.company.trim() ? { company: person.company } : {}),
          },
          preview: {
            kind: "contacts",
            contacts: [
              {
                formattedName: person.name,
                phones: [{ phone: person.phone }],
                ...(person.email.trim() ? { emails: [{ email: person.email }] } : {}),
                ...(person.company.trim() ? { org: { company: person.company } } : {}),
              },
            ],
          },
        };
      case "buttons": {
        const titles = buttons.map((title) => title.trim()).filter(Boolean);
        if (!body.trim()) return "Write the message the buttons sit under.";
        if (titles.length === 0) return "Add at least one button.";
        return {
          message: {
            kind: "buttons",
            body,
            buttons: titles,
            ...(header.trim() ? { header } : {}),
            ...(footer.trim() ? { footer } : {}),
          },
          preview: {
            kind: "buttons",
            body,
            buttons: titles.map((title, index) => ({ id: String(index), title })),
            header: header.trim() ? { type: "text", text: header } : undefined,
            footer: footer.trim() || undefined,
          },
        };
      }
      case "list": {
        const filled = sections
          .map((section) => ({ title: section.title, rows: section.rows.filter((row) => row.title.trim()) }))
          .filter((section) => section.rows.length > 0);
        if (!body.trim()) return "Write the message the list opens from.";
        if (!listButton.trim()) return "Name the button that opens the list.";
        if (filled.length === 0) return "Add at least one row.";
        if (filled.length > 1 && filled.some((section) => !section.title.trim())) {
          return "With more than one section, every section needs a title.";
        }
        return {
          message: {
            kind: "list",
            body,
            buttonText: listButton,
            sections: filled.map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({
                title: row.title,
                ...(row.description.trim() ? { description: row.description } : {}),
              })),
            })),
            ...(header.trim() ? { header } : {}),
            ...(footer.trim() ? { footer } : {}),
          },
          preview: {
            kind: "list",
            body,
            buttonText: listButton,
            sections: filled.map((section, s) => ({
              title: section.title,
              rows: section.rows.map((row, r) => ({
                id: `${s}-${r}`,
                title: row.title,
                description: row.description.trim() || undefined,
              })),
            })),
            header: header.trim() ? { type: "text", text: header } : undefined,
            footer: footer.trim() || undefined,
          },
        };
      }
      case "cta_url":
        if (!body.trim()) return "Write the message the link sits under.";
        if (!linkLabel.trim()) return "Give the button a label.";
        if (!/^https?:\/\/\S+\.\S+/i.test(link.trim())) return "Enter a full web address, starting with https://.";
        return {
          message: { kind: "cta_url", body, displayText: linkLabel, url: link.trim(), ...(footer.trim() ? { footer } : {}) },
          preview: { kind: "cta_url", body, displayText: linkLabel, url: link.trim(), footer: footer.trim() || undefined },
        };
      case "request_location":
        if (!body.trim()) return "Say why you are asking for their location.";
        return { message: { kind: "request_location", body }, preview: { kind: "request_location", body } };
      case "template": {
        if (!template) return "No approved template to send.";
        const slots = template.slots.filter((slot) => !(slot.key === "header:media" && upload));
        const missing = slots.find((slot) => !values[slot.key]?.trim());
        const mediaLink = upload?.url ?? values["header:media"];
        const preview: Outbound = {
          kind: "template",
          templateName: template.name,
          languageCode: template.language,
          preview: [
            template.header?.format === "TEXT" ? fillVariables(template.header.text ?? "", values, "header") : "",
            fillVariables(template.body ?? "", values, "body"),
          ]
            .filter(Boolean)
            .join("\n\n"),
          ...(mediaLink && (headerMediaKind === "image" || headerMediaKind === "video")
            ? { headerMedia: { type: headerMediaKind, link: mediaLink } }
            : {}),
          footer: template.footer ?? undefined,
          buttons: template.buttons.map((button) => ({
            type: button.type === "URL" ? "url" : button.type === "PHONE_NUMBER" ? "phone" : "quick_reply",
            text: button.text,
          })),
        };
        if (missing) return `Fill in ${missing.label}.`;
        return {
          message: {
            kind: "template",
            templateId: template._id,
            values: Object.fromEntries(
              Object.entries(values).filter(([key]) => !(key === "header:media" && upload))
            ),
            ...(upload && headerMediaKind ? { headerKey: upload.key } : {}),
          },
          preview,
        };
      }
    }
  })();

  const submit = async () => {
    if (typeof composed === "string" || sending) return;
    setSending(true);
    try {
      const result = await send({ conversationId, message: composed.message, teamMemberId, pauseMinutes });
      if (result.ok) {
        toast.add({ title: "Sent", type: "success" });
        onClose();
      } else {
        toast.add({ title: "Not sent", description: result.error, type: "error" });
      }
    } catch (error) {
      toast.add({ title: "Not sent", description: friendlyError(error), type: "error" });
    } finally {
      setSending(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncTemplates({ workspaceId });
      toast.add({
        title: "Templates synced",
        description: `${result.approved} of ${result.count} approved.`,
        type: "success",
      });
    } catch (error) {
      toast.add({ title: "Could not sync", description: friendlyError(error), type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const setSection = (index: number, next: (typeof sections)[number]) =>
    setSections(sections.map((section, at) => (at === index ? next : section)));

  const form = (() => {
    switch (kind) {
      case "image":
      case "video":
      case "audio":
      case "document":
        return (
          <>
            <Field label="File">
              <FilePick kind={kind} conversationId={conversationId} value={upload} onChange={setUpload} />
            </Field>
            {kind !== "audio" ? (
              <Field label="Caption (optional)">
                <Counted value={caption} onChange={setCaption} max={1024} multiline />
              </Field>
            ) : null}
          </>
        );
      case "location":
        return (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <Input
                  value={place.latitude}
                  inputMode="decimal"
                  placeholder="19.0760"
                  onChange={(event) => setPlace({ ...place, latitude: event.target.value })}
                />
              </Field>
              <Field label="Longitude">
                <Input
                  value={place.longitude}
                  inputMode="decimal"
                  placeholder="72.8777"
                  onChange={(event) => setPlace({ ...place, longitude: event.target.value })}
                />
              </Field>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              Right-click a spot on Google Maps to copy its coordinates.
            </p>
            <Field label="Place name (optional)">
              <Input value={place.name} onChange={(event) => setPlace({ ...place, name: event.target.value })} />
            </Field>
            <Field label="Address (optional)">
              <Input value={place.address} onChange={(event) => setPlace({ ...place, address: event.target.value })} />
            </Field>
          </>
        );
      case "contact":
        return (
          <>
            <Field label="Name">
              <Input value={person.name} onChange={(event) => setPerson({ ...person, name: event.target.value })} />
            </Field>
            <Field label="Phone" hint="With the country code, like +919876543210.">
              <Input
                value={person.phone}
                inputMode="tel"
                onChange={(event) => setPerson({ ...person, phone: event.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email (optional)">
                <Input value={person.email} onChange={(event) => setPerson({ ...person, email: event.target.value })} />
              </Field>
              <Field label="Company (optional)">
                <Input value={person.company} onChange={(event) => setPerson({ ...person, company: event.target.value })} />
              </Field>
            </div>
          </>
        );
      case "buttons":
      case "list":
        return (
          <>
            <Field label="Header (optional)">
              <Counted value={header} onChange={setHeader} max={60} />
            </Field>
            <Field label="Message">
              <Counted value={body} onChange={setBody} max={1024} multiline />
            </Field>
            <Field label="Footer (optional)">
              <Counted value={footer} onChange={setFooter} max={60} />
            </Field>
            {kind === "buttons" ? (
              <Field label="Buttons" hint="Up to three. A tap comes back as the customer's reply.">
                <div className="flex flex-col gap-2">
                  {buttons.map((title, index) => (
                    <Counted
                      key={index}
                      value={title}
                      max={20}
                      placeholder={`Button ${index + 1}`}
                      onChange={(next) => setButtons(buttons.map((one, at) => (at === index ? next : one)))}
                    />
                  ))}
                </div>
              </Field>
            ) : (
              <>
                <Field label="List button">
                  <Counted value={listButton} onChange={setListButton} max={20} />
                </Field>
                {sections.map((section, s) => (
                  <div key={s} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Counted
                          value={section.title}
                          max={24}
                          placeholder={sections.length > 1 ? "Section title" : "Section title (optional)"}
                          onChange={(title) => setSection(s, { ...section, title })}
                        />
                      </div>
                      {sections.length > 1 ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Remove section"
                          onClick={() => setSections(sections.filter((_, at) => at !== s))}
                        >
                          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      ) : null}
                    </div>
                    {section.rows.map((row, r) => (
                      <div key={r} className="flex items-start gap-2 pl-3">
                        <div className="grid flex-1 gap-1.5">
                          <Counted
                            value={row.title}
                            max={24}
                            placeholder="Row title"
                            onChange={(title) =>
                              setSection(s, {
                                ...section,
                                rows: section.rows.map((one, at) => (at === r ? { ...one, title } : one)),
                              })
                            }
                          />
                          <Counted
                            value={row.description}
                            max={72}
                            placeholder="Description (optional)"
                            onChange={(description) =>
                              setSection(s, {
                                ...section,
                                rows: section.rows.map((one, at) => (at === r ? { ...one, description } : one)),
                              })
                            }
                          />
                        </div>
                        {section.rows.length > 1 ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Remove row"
                            onClick={() =>
                              setSection(s, { ...section, rows: section.rows.filter((_, at) => at !== r) })
                            }
                          >
                            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="self-start"
                      disabled={rowCount >= 10}
                      onClick={() =>
                        setSection(s, { ...section, rows: [...section.rows, { title: "", description: "" }] })
                      }
                    >
                      <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Row
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rowCount >= 10 || sections.length >= 10}
                    onClick={() => setSections([...sections, { title: "", rows: [{ title: "", description: "" }] }])}
                  >
                    <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Section
                  </Button>
                  <span className="text-xs text-muted-foreground">{rowCount}/10 rows</span>
                </div>
              </>
            )}
          </>
        );
      case "cta_url":
        return (
          <>
            <Field label="Message">
              <Counted value={body} onChange={setBody} max={1024} multiline />
            </Field>
            <Field label="Button label">
              <Counted value={linkLabel} onChange={setLinkLabel} max={20} placeholder="Open website" />
            </Field>
            <Field label="Link">
              <Input value={link} placeholder="https://" onChange={(event) => setLink(event.target.value)} />
            </Field>
            <Field label="Footer (optional)">
              <Counted value={footer} onChange={setFooter} max={60} />
            </Field>
          </>
        );
      case "request_location":
        return (
          <Field label="Message" hint="WhatsApp shows a Send location button under it.">
            <Counted value={body} onChange={setBody} max={1024} multiline />
          </Field>
        );
      case "template":
        return templates === undefined ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading templates…
          </p>
        ) : sendable.length === 0 ? (
          <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
            <p>
              {templates.length === 0
                ? "No templates synced for this WhatsApp number yet."
                : "None of this number's templates are approved yet."}
            </p>
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
              {syncing ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} Sync from WhatsApp
            </Button>
          </div>
        ) : (
          <>
            <Field label="Template">
              <div className="flex items-center gap-2">
                <SelectField
                  value={template?._id ?? ""}
                  onValueChange={(next) => {
                    setTemplateId(next);
                    setValues({});
                    setUpload(null);
                  }}
                  aria-label="Template"
                  className="min-w-0 flex-1"
                  options={sendable.map((one) => ({
                    value: one._id,
                    label: `${one.name} · ${one.language} · ${one.category.toLowerCase()}`,
                  }))}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sync templates"
                  title="Sync templates from WhatsApp"
                  disabled={syncing}
                  onClick={() => void sync()}
                >
                  {syncing ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />}
                </Button>
              </div>
            </Field>
            {template?.slots.map((slot) =>
              slot.key === "header:media" && headerMediaKind ? (
                <Field key={slot.key} label={`Header ${headerMediaKind}`} hint="Upload one, or paste a public link.">
                  <FilePick kind={headerMediaKind} conversationId={conversationId} value={upload} onChange={setUpload} />
                  {upload ? null : (
                    <Input
                      value={values[slot.key] ?? ""}
                      placeholder="https://"
                      onChange={(event) => setValues({ ...values, [slot.key]: event.target.value })}
                    />
                  )}
                </Field>
              ) : (
                <Field key={slot.key} label={slot.label}>
                  <Input
                    value={values[slot.key] ?? ""}
                    placeholder={slot.example ?? ""}
                    onChange={(event) => setValues({ ...values, [slot.key]: event.target.value })}
                  />
                </Field>
              )
            )}
            {template && template.slots.length === 0 ? (
              <p className="text-xs text-muted-foreground">This template has no blanks to fill.</p>
            ) : null}
          </>
        );
      default:
        return null;
    }
  })();

  const preview = typeof composed === "string" ? null : composed.preview;
  const fallbackPreview: Outbound | null =
    kind === "template" && template && typeof composed === "string"
      ? {
          kind: "template",
          templateName: template.name,
          languageCode: template.language,
          preview: fillVariables(template.body ?? "", values, "body"),
          footer: template.footer ?? undefined,
        }
      : null;
  const shown = preview ?? fallbackPreview;

  return (
    <Dialog open={kind !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-y-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{kind ? TITLES[kind] : ""}</DialogTitle>
          <DialogDescription>
            {kind === "template"
              ? "Approved templates reach the customer at any time, even after the 24-hour window."
              : windowClosed
                ? "The reply window is closed, so WhatsApp will likely reject this. Send a template instead."
                : "Goes out on WhatsApp and pauses the agent, like a typed reply."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto sm:grid-cols-[1fr_17rem]">
          <div className="flex flex-col gap-3.5">{form}</div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Preview</Label>
            <div className="flex min-h-40 items-start rounded-lg bg-[#efeae2] p-3 dark:bg-[#0b141a]">
              {shown ? (
                <div className="ml-auto max-w-full rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
                  <RichMessage message={shown} interactive={false} />
                </div>
              ) : (
                <p className="m-auto text-center text-xs text-muted-foreground">
                  {typeof composed === "string" ? composed : ""}
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          {typeof composed === "string" && composed ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">{composed}</p>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={sending || typeof composed === "string"} onClick={() => void submit()}>
            {sending ? <Spinner /> : null} Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
