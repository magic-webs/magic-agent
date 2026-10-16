// Where a CSV column or a webhook path goes in a record book. No Convex
// imports, so the import dialog and the webhook card share the same targets.

export const SKIP = "skip";
export const EXTRA = "extra";

export type MappingRow = { source: string; target: string };

type Person = { name?: string; phone?: string; email?: string; company?: string };

export type MappedRecord = {
  values: Array<{ key: string; value: string }>;
  person?: Person;
  stage?: string;
  notes?: string;
};

type BookShape = {
  fields: Array<{ key: string; label: string }>;
  stages: string[];
};

const PERSON_PARTS = ["name", "phone", "email", "company"] as const;

const PERSON: Record<string, string> = {
  name: "person.name",
  fullname: "person.name",
  customername: "person.name",
  phone: "person.phone",
  mobile: "person.phone",
  phonenumber: "person.phone",
  whatsapp: "person.phone",
  email: "person.email",
  emailaddress: "person.email",
  company: "person.company",
  companyname: "person.company",
  business: "person.company",
};

const IGNORED = new Set(["serial", "reference", "source", "filedby", "filedat", "updatedat"]);

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const sameSource = (a: string, b: string) => norm(a) === norm(b);

export function targetOptions(book: BookShape): Array<{ value: string; label: string }> {
  return [
    { value: SKIP, label: "Skip" },
    ...book.fields.map((field) => ({ value: `field:${field.key}`, label: field.label })),
    { value: "person.name", label: "Person · name" },
    { value: "person.phone", label: "Person · phone" },
    { value: "person.email", label: "Person · email" },
    { value: "person.company", label: "Person · company" },
    ...(book.stages.length ? [{ value: "stage", label: "Stage" }] : []),
    { value: "notes", label: "Notes" },
    { value: EXTRA, label: "Keep as an extra detail" },
  ];
}

export function validTarget(book: BookShape, target: string): boolean {
  return targetOptions(book).some((option) => option.value === target);
}

/** A best guess from a column header or the last part of a path. */
export function guessTarget(book: BookShape, source: string): string {
  const key = norm(source.split(".").filter((part) => !/^\d+$/.test(part)).pop() ?? "");
  const field = book.fields.find(
    (option) => norm(option.key) === key || norm(option.label) === key
  );
  if (field) return `field:${field.key}`;
  if (PERSON[key]) return PERSON[key];
  if (key === "stage" && book.stages.length > 0) return "stage";
  if (key === "notes" || key === "note") return "notes";
  if (IGNORED.has(key) || !key) return SKIP;
  return EXTRA;
}

/** The target a saved mapping gives a source, when it still fits the book. */
export function savedTarget(
  book: BookShape,
  mapping: MappingRow[] | undefined,
  source: string
): string | undefined {
  const found = mapping?.find((row) => sameSource(row.source, source));
  return found && validTarget(book, found.target) ? found.target : undefined;
}

/** Puts one value where its target says. */
export function applyTarget(
  record: MappedRecord,
  target: string,
  source: string,
  value: string
): void {
  const text = value.trim();
  if (!text || target === SKIP) return;
  if (target.startsWith("field:")) {
    record.values.push({ key: target.slice(6), value: text });
  } else if (target.startsWith("person.")) {
    const part = target.slice(7) as (typeof PERSON_PARTS)[number];
    if (PERSON_PARTS.includes(part)) {
      record.person = { ...record.person, [part]: record.person?.[part] ?? text };
    }
  } else if (target === "stage") {
    record.stage ??= text;
  } else if (target === "notes") {
    record.notes = record.notes ? `${record.notes}\n${text}` : text;
  } else {
    record.values.push({ key: source.trim().slice(0, 60) || "extra", value: text });
  }
}
