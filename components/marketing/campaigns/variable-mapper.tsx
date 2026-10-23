"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { variablesIn } from "@/convex/lib/marketing";
import {
  MAX_FILL,
  defaultFill,
  fillProblems,
  isPersonal,
  type VariableFill,
  type VariableSource,
} from "@/convex/lib/personalise";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const LABEL: Record<Exclude<VariableSource, "attribute">, string> = {
  first_name: "First name",
  full_name: "Full name",
  phone: "Phone number",
  email: "Email",
  company: "Company",
  birthday: "Birthday",
  business: "Business name",
  campaign: "Campaign name",
  date: "Campaign date",
  text: "Type your own text",
};

const CONTACT_SOURCES = ["first_name", "full_name", "phone", "email", "company", "birthday"] as const;
const SHARED_SOURCES = ["business", "campaign", "date", "text"] as const;

export function fillLabel(fill: VariableFill): string {
  if (fill.source === "attribute") return fill.key ?? "Contact field";
  if (fill.source === "text") {
    const text = fill.text?.trim() ?? "";
    return text ? `“${text.length > 24 ? `${text.slice(0, 24)}…` : text}”` : "Your own text";
  }
  return LABEL[fill.source];
}

function choose(fill: VariableFill, next: string): VariableFill {
  const fallback = fill.fallback || "";
  if (next.startsWith("attribute:")) {
    return { variable: fill.variable, source: "attribute", key: next.slice("attribute:".length), fallback };
  }
  const source = next as VariableSource;
  return {
    variable: fill.variable,
    source,
    ...(source === "text" ? { text: fill.text ?? "" } : {}),
    ...(isPersonal(source)
      ? { fallback: fallback || (source === "first_name" || source === "full_name" ? "there" : "") }
      : {}),
  };
}

export function VariableMapper({
  body,
  fills,
  onChange,
}: {
  body: string;
  fills: VariableFill[];
  onChange: (fills: VariableFill[]) => void;
}) {
  const workspace = useWorkspace();
  const fields = useQuery(api.marketing.contactFields, { workspaceId: workspace._id });
  const variables = variablesIn(body);
  if (variables.length === 0) return null;

  const fillOf = (variable: VariableFill["variable"]) =>
    fills.find((fill) => fill.variable === variable) ?? defaultFill(variable);
  const update = (variable: VariableFill["variable"], next: VariableFill) =>
    onChange(variables.map((name) => (name === variable ? next : fillOf(name))));

  const counted = (label: string, count: number | undefined) =>
    fields && count !== undefined ? `${label} (${count.toLocaleString()} have it)` : label;
  const contactCount: Partial<Record<VariableSource, number>> = fields
    ? { first_name: fields.named, full_name: fields.named, email: fields.email, company: fields.company, birthday: fields.birthday }
    : {};
  const attributeKeys = new Map((fields?.attributes ?? []).map((row) => [row.key.toLowerCase(), row]));
  for (const fill of fills) {
    if (fill.source === "attribute" && fill.key && !attributeKeys.has(fill.key.toLowerCase())) {
      attributeKeys.set(fill.key.toLowerCase(), { key: fill.key, count: 0 });
    }
  }
  const options = [
    ...CONTACT_SOURCES.map((source) => ({
      value: source,
      label: `Contact · ${counted(LABEL[source], contactCount[source])}`,
    })),
    ...[...attributeKeys.values()].map((row) => ({
      value: `attribute:${row.key}`,
      label: `Contact · ${row.count ? counted(row.key, row.count) : row.key}`,
    })),
    ...SHARED_SOURCES.map((source) => ({ value: source, label: LABEL[source] })),
  ];
  const problems = fillProblems(body, variables.map(fillOf));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-semibold">Fill the blanks</p>
        <p className="text-xs text-muted-foreground">
          Pick what goes in each blank. Contact details are filled for each person, so everyone reads
          their own name, city or membership.
        </p>
      </div>
      <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
        {body.split(/(\{\{\s*\w+\s*\}\})/).map((part, i) => {
          const index = variables.indexOf(part.replace(/[{}\s]/g, "") as VariableFill["variable"]);
          if (index === -1) return part;
          return (
            <span
              key={i}
              title={fillLabel(fillOf(variables[index]))}
              className="rounded bg-primary/10 px-1 font-mono text-xs font-medium text-primary"
            >
              {`{{${index + 1}}}`}
            </span>
          );
        })}
      </p>
      {variables.map((variable, index) => {
        const fill = fillOf(variable);
        const label = `{{${index + 1}}}`;
        return (
          <div
            key={variable}
            className="grid gap-2 sm:grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] sm:items-start"
          >
            <span className="font-mono text-sm font-medium sm:pt-1.5">{label}</span>
            <SelectField
              aria-label={`What fills ${label}`}
              value={fill.source === "attribute" ? `attribute:${fill.key ?? ""}` : fill.source}
              onValueChange={(next) => update(variable, choose(fill, next))}
              options={options}
            />
            {fill.source === "text" ? (
              variable === "message" ? (
                <Textarea
                  aria-label={`Text for ${label}`}
                  rows={2}
                  maxLength={MAX_FILL}
                  value={fill.text ?? ""}
                  placeholder="The text everyone gets here"
                  onChange={(e) => update(variable, { ...fill, text: e.target.value })}
                />
              ) : (
                <Input
                  aria-label={`Text for ${label}`}
                  maxLength={MAX_FILL}
                  value={fill.text ?? ""}
                  placeholder="The text everyone gets here"
                  onChange={(e) => update(variable, { ...fill, text: e.target.value })}
                />
              )
            ) : isPersonal(fill.source) ? (
              <div className="flex flex-col gap-1">
                <Input
                  aria-label={`If a contact has no value for ${label}, use`}
                  maxLength={MAX_FILL}
                  value={fill.fallback ?? ""}
                  placeholder="If missing, use…"
                  onChange={(e) => update(variable, { ...fill, fallback: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">Used when a contact has nothing saved</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground sm:pt-2">Same for everyone</span>
            )}
          </div>
        );
      })}
      {problems.length > 0 ? <p className="text-xs font-medium text-destructive">{problems[0]}</p> : null}
    </div>
  );
}
