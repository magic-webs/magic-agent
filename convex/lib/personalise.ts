import {
  asParameter,
  greetingName,
  variablesIn,
  type TemplateVariable,
} from "./marketing";

export const VARIABLE_SOURCES = [
  "first_name",
  "full_name",
  "phone",
  "email",
  "company",
  "birthday",
  "attribute",
  "business",
  "campaign",
  "date",
  "text",
] as const;

export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export type VariableFill = {
  variable: TemplateVariable;
  source: VariableSource;
  key?: string;
  text?: string;
  fallback?: string;
};

export type Person = {
  name?: string;
  externalId?: string;
  phone?: string;
  email?: string;
  company?: string;
  birthday?: string;
  attributes?: Array<{ key: string; value: string }>;
};

export type SharedValues = Omit<Record<TemplateVariable, string>, "name">;

export const MAX_FILL = 400;

const PERSONAL = new Set<VariableSource>([
  "first_name",
  "full_name",
  "phone",
  "email",
  "company",
  "birthday",
  "attribute",
]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isPersonal(source: VariableSource): boolean {
  return PERSONAL.has(source);
}

export function defaultFill(variable: TemplateVariable, message = ""): VariableFill {
  switch (variable) {
    case "name":
      return { variable, source: "first_name", fallback: "there" };
    case "business":
      return { variable, source: "business" };
    case "event":
      return { variable, source: "campaign" };
    case "date":
      return { variable, source: "date" };
    case "message":
      return { variable, source: "text", text: message };
    case "venue":
      return { variable, source: "text", text: "" };
  }
}

export function fillsFor(
  body: string,
  saved: VariableFill[] | undefined,
  message?: string
): VariableFill[] {
  return variablesIn(body).map(
    (variable) => saved?.find((fill) => fill.variable === variable) ?? defaultFill(variable, message)
  );
}

function birthdayLabel(birthday: string | undefined): string {
  const match = birthday?.match(/(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const month = MONTHS[Number(match[1]) - 1];
  return month ? `${Number(match[2])} ${month}` : "";
}

function personValue(fill: VariableFill, person: Person): string {
  switch (fill.source) {
    case "first_name": {
      const first = person.name?.trim().split(/\s+/)[0];
      return first && /\p{L}/u.test(first) ? first : "";
    }
    case "full_name":
      return person.name ?? "";
    case "phone":
      return person.phone || (person.externalId ? `+${person.externalId}` : "");
    case "email":
      return person.email ?? "";
    case "company":
      return person.company ?? "";
    case "birthday":
      return birthdayLabel(person.birthday);
    case "attribute": {
      const key = fill.key?.trim().toLowerCase();
      return person.attributes?.find((row) => row.key.trim().toLowerCase() === key)?.value ?? "";
    }
    default:
      return "";
  }
}

export function fillValue(fill: VariableFill, shared: SharedValues, person: Person | null): string {
  const raw =
    fill.source === "business"
      ? shared.business
      : fill.source === "campaign"
        ? shared.event
        : fill.source === "date"
          ? shared.date
          : fill.source === "text"
            ? (fill.text ?? "")
            : person
              ? personValue(fill, person)
              : "";
  return asParameter(raw).slice(0, MAX_FILL) || asParameter(fill.fallback ?? "").slice(0, MAX_FILL);
}

export function personalValues(
  fills: VariableFill[] | undefined,
  shared: SharedValues,
  person: Person | null
): Record<TemplateVariable, string> {
  const values: Record<TemplateVariable, string> = { ...shared, name: greetingName(person?.name) };
  for (const fill of fills ?? []) values[fill.variable] = fillValue(fill, shared, person);
  return values;
}

export function fillProblems(body: string, fills: VariableFill[]): string[] {
  const problems: string[] = [];
  for (const [index, variable] of variablesIn(body).entries()) {
    const fill = fills.find((row) => row.variable === variable);
    if (!fill) continue;
    const label = `{{${index + 1}}}`;
    if (fill.source === "text" && !asParameter(fill.text ?? "")) {
      problems.push(`Write the text for ${label}.`);
    } else if (fill.source === "attribute" && !fill.key?.trim()) {
      problems.push(`Pick the contact field for ${label}.`);
    } else if (isPersonal(fill.source) && !asParameter(fill.fallback ?? "")) {
      problems.push(`Give ${label} a word to use when a contact has nothing saved.`);
    }
  }
  return problems;
}

export function cleanFills(body: string, fills: VariableFill[]): VariableFill[] {
  const used = new Set(variablesIn(body));
  return fills
    .filter((fill) => used.has(fill.variable))
    .map((fill) => ({
      variable: fill.variable,
      source: fill.source,
      ...(fill.source === "attribute" && fill.key?.trim() ? { key: fill.key.trim().slice(0, 60) } : {}),
      ...(fill.source === "text" ? { text: (fill.text ?? "").slice(0, MAX_FILL) } : {}),
      ...(isPersonal(fill.source) && fill.fallback?.trim()
        ? { fallback: fill.fallback.trim().slice(0, MAX_FILL) }
        : {}),
    }));
}
