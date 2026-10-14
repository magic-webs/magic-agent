"use client";

import { useMemo, useState } from "react";
import { AGENT_TEMPLATES } from "@/convex/lib/agentTemplates";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CurrencyPicker,
  LocalePicker,
  TimezonePicker,
} from "@/components/regional-pickers";

export type WorkspaceBasics = {
  name: string;
  tagline: string;
  industry: string;
  description: string;
  website: string;
  supportEmail: string;
  supportPhone: string;
  ownerName: string;
  address: string;
  locale: string;
  currency: string;
  timezone: string;
};

export type SetupOptions = {
  agents: string[];
  extraPages: string;
  catalogue: boolean;
  leadStages: boolean;
  webChannel: boolean;
  login: boolean;
  notes: string;
};

export const DEFAULT_SETUP_OPTIONS: SetupOptions = {
  agents: ["support", "sales"],
  extraPages: "",
  catalogue: true,
  leadStages: true,
  webChannel: true,
  login: true,
  notes: "",
};

const REGION_FALLBACK = "work it out from where the business operates";

const line = (label: string, value: string, fallback?: string) =>
  value.trim()
    ? `- ${label}: ${value.trim()}`
    : fallback
      ? `- ${label}: ${fallback}`
      : null;

export function buildSetupPrompt(
  basics: WorkspaceBasics,
  options: SetupOptions,
): string {
  const name = basics.name.trim() || "the company";
  const website = basics.website.trim();
  const pages = options.extraPages
    .split(/\s+/)
    .map((page) => page.trim())
    .filter(Boolean);
  const agents = AGENT_TEMPLATES.filter((template) =>
    options.agents.includes(template.key),
  );

  const business = [
    line("Name", basics.name),
    line("Website", website),
    line("Industry", basics.industry, "work it out from the website"),
    line("Tagline", basics.tagline),
    line(
      "What they do",
      basics.description,
      "read the website and write it in 2–4 sentences",
    ),
    line("Owner, as agents should address them", basics.ownerName),
    line("Support email", basics.supportEmail),
    line("Support phone", basics.supportPhone),
    line("Address", basics.address),
    line("Locale", basics.locale, REGION_FALLBACK),
    line("Currency", basics.currency, REGION_FALLBACK),
    line("Timezone", basics.timezone, REGION_FALLBACK),
  ].filter(Boolean);

  const steps: string[] = [];
  const step = (text: string) => steps.push(`${steps.length + 1}. ${text}`);

  step(
    `Research. ${website ? `Fetch ${website} and its key pages` : "Find the company's website and fetch its key pages"} — home, about, products or services, pricing, FAQ, contact, delivery, returns and other policies.${pages.length ? ` Also read: ${pages.join(", ")}.` : ""} Everything below comes from what you read; never invent prices, policies, hours or stock.`,
  );
  step(
    `create_workspace with the name, website, industry, tagline, a 2–4 sentence description, the contact details, locale, currency and timezone above, and facts (opening hours, service areas, delivery, payment methods, anything an agent may state) taken from the site.`,
  );
  step("ensure_front_desk, so every channel has a router.");
  if (agents.length > 0) {
    step(
      [
        `Create these agents with create_agent, fitted to ${name} from what you read, then update_agent each to status "active". Write routingDescription as "hand over when…" — the front desk routes on nothing else.`,
        ...agents.map(
          (agent) =>
            `   - ${agent.name} (bot name ${agent.botName}, role "${agent.role}"): ${agent.summary} Hand over when ${agent.routingDescription}.`,
        ),
      ].join("\n"),
    );
  }
  step(
    `Knowledge base. For each useful page, fetch it yourself and save its readable content with add_knowledge — kind "text", or "faq" for question-and-answer pages — with the page's address in url. One source per page or topic, no navigation, footers or scripts. Never pass a bare URL. Check list_knowledge until every source is "ready".`,
  );
  if (options.catalogue) {
    step(
      `Catalogue. Add the products and services the site lists with create_product (kind "product" or "service"), with a price only where the site states one. Give each product the questions an agent must ask before an order in requirementFields. Add any brochure, price list or menu PDF linked on the site with kind "brochure" and the PDF in files.`,
    );
  }
  if (options.leadStages)
    step("seed_default_lead_stages for the enquiry pipeline.");
  if (options.webChannel) {
    step(
      `create_channel of type "web" pointed at the front desk. Ask me first whether the widget should collect the visitor's name and number in the chat (intake "chat") or on a sign-in page (intake "form").`,
    );
  }
  step(
    `Test. chat_with_agent on the front desk with three realistic customer messages — a product question, a support question and something the business does not do. Check handoffPath and that answers come from the knowledge base and catalogue; fix routingDescriptions or knowledge where they fall short.`,
  );
  if (options.login) {
    step(
      "issue_workspace_password so the company can sign in, and give me the login.",
    );
  }

  return [
    `Set up a new Magic Agent workspace for ${name} using the Magic Agent MCP tools.`,
    "",
    "## The business",
    ...business,
    ...(options.notes.trim() ? ["", "## Notes", options.notes.trim()] : []),
    "",
    "## Steps",
    ...steps,
    "",
    "Finish with a summary: the workspace slug, each agent and what it handles, the knowledge sources, the catalogue, and anything you could not find that the team must supply.",
  ].join("\n");
}

export function SetupPromptFields({
  basics,
  setBasic,
  options,
  setOptions,
}: {
  basics: WorkspaceBasics;
  setBasic: (key: keyof WorkspaceBasics) => (value: string) => void;
  options: SetupOptions;
  setOptions: (next: SetupOptions) => void;
}) {
  const [touched, setTouched] = useState(false);
  const prompt = useMemo(
    () => buildSetupPrompt(basics, options),
    [basics, options],
  );
  const toggle = (key: "catalogue" | "leadStages" | "webChannel" | "login") =>
    setOptions({ ...options, [key]: !options[key] });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-name">Company name</Label>
          <Input
            id="sp-name"
            value={basics.name}
            placeholder="Company or project name"
            aria-invalid={touched && !basics.name.trim()}
            onBlur={() => setTouched(true)}
            onChange={(event) => setBasic("name")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-website">Website</Label>
          <Input
            id="sp-website"
            value={basics.website}
            placeholder="Website address"
            onChange={(event) => setBasic("website")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-industry">Industry</Label>
          <Input
            id="sp-industry"
            value={basics.industry}
            placeholder="Read from the website if blank"
            onChange={(event) => setBasic("industry")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-owner">Owner&apos;s name</Label>
          <Input
            id="sp-owner"
            value={basics.ownerName}
            placeholder="How agents should address them"
            onChange={(event) => setBasic("ownerName")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-email">Support email</Label>
          <Input
            id="sp-email"
            value={basics.supportEmail}
            placeholder="Email address"
            onChange={(event) => setBasic("supportEmail")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sp-phone">Support phone</Label>
          <Input
            id="sp-phone"
            value={basics.supportPhone}
            placeholder="Phone number"
            onChange={(event) => setBasic("supportPhone")(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="sp-locale">Locale</Label>
          <LocalePicker
            id="sp-locale"
            value={basics.locale}
            onValueChange={setBasic("locale")}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="sp-currency">Currency</Label>
          <CurrencyPicker
            id="sp-currency"
            value={basics.currency}
            onValueChange={setBasic("currency")}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="sp-tz">Timezone</Label>
          <TimezonePicker
            id="sp-tz"
            value={basics.timezone}
            onValueChange={setBasic("timezone")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-pages">Other pages or documents to read</Label>
        <Textarea
          id="sp-pages"
          rows={2}
          value={options.extraPages}
          placeholder="One link per line"
          onChange={(event) =>
            setOptions({ ...options, extraPages: event.target.value })
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Default agents</Label>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {AGENT_TEMPLATES.map((template) => (
            <label
              key={template.key}
              className="flex items-start gap-2 rounded-md border p-2 text-sm"
            >
              <Checkbox
                className="mt-0.5"
                checked={options.agents.includes(template.key)}
                onCheckedChange={(checked) =>
                  setOptions({
                    ...options,
                    agents: checked
                      ? [...options.agents, template.key]
                      : options.agents.filter((key) => key !== template.key),
                  })
                }
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{template.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {template.summary}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Also set up</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {(
            [
              ["catalogue", "Catalogue from the website"],
              ["leadStages", "Default lead stages"],
              ["webChannel", "Web chat channel"],
              ["login", "Company login"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <Checkbox
                checked={options[key]}
                onCheckedChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-notes">Notes for the setup</Label>
        <Textarea
          id="sp-notes"
          rows={2}
          value={options.notes}
          placeholder="Anything the setup should know — languages, tone, topics to avoid"
          onChange={(event) =>
            setOptions({ ...options, notes: event.target.value })
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sp-prompt">Prompt</Label>
        <Textarea
          id="sp-prompt"
          readOnly
          rows={12}
          value={prompt}
          className="font-mono text-xs"
          onFocus={(event) => event.target.select()}
        />
        <p className="text-xs text-muted-foreground">
          Paste it into Claude with the Magic Agent connector. It creates the
          workspace, its agents and knowledge base from the website.
        </p>
      </div>
    </div>
  );
}
