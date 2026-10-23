import { normaliseBirthday } from "./marketing";
import { normaliseEmail, normalisePhone } from "./notifications";

export type KeyValue = { key: string; value: string };

export type RawContact = {
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  birthday?: string;
  tags?: string;
  notes?: string;
  fields?: KeyValue[];
};

export type CleanContact = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  birthday?: string;
  tags: string[];
  notes?: string;
  fields?: KeyValue[];
};

export const MAX_FIELDS = 40;
const IMPORT_FIELDS = 30;

const sameKey = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function cleanFields(raw: KeyValue[] | undefined): KeyValue[] | undefined {
  const fields: KeyValue[] = [];
  for (const entry of raw ?? []) {
    const key = tidyText(entry.key).slice(0, 40);
    const value = tidyText(entry.value).slice(0, 200);
    if (!key || !value || fields.some((row) => sameKey(row.key, key))) continue;
    fields.push({ key, value });
    if (fields.length === IMPORT_FIELDS) break;
  }
  return fields.length ? fields : undefined;
}

/** `incoming` laid over `current` by key; `replace` decides whether a key both have takes the new value. */
export function mergeFields(current: KeyValue[], incoming: KeyValue[], replace: boolean): KeyValue[] {
  const next = [...current];
  for (const entry of incoming) {
    const index = next.findIndex((row) => sameKey(row.key, entry.key));
    if (index === -1) next.push(entry);
    else if (replace) next[index] = { key: next[index].key, value: entry.value };
  }
  return next.slice(-MAX_FIELDS);
}

const headerText = (header: string) =>
  header.toLowerCase().replace(/[_\-.:]+/g, " ").replace(/\s+/g, " ").trim();

/** A column that only numbers the rows — "S.No.", "Serial Number", "#". */
export function isCounterColumn(header: string): boolean {
  return /^(s ?no|sr ?no|sl ?no|serial( number| no)?|#|no|id|row( number| no)?)$/.test(headerText(header));
}

export function isNotesColumn(header: string): boolean {
  return /^(notes?|remarks?|comments?)$/.test(headerText(header));
}

/** Notes an older import wrote as "Header: value; Header: value", read back as fields and whatever else they held. */
export function fieldsFromNotes(notes: string): { fields: KeyValue[]; rest: string[] } {
  const fields: KeyValue[] = [];
  const rest: string[] = [];
  for (const part of notes.split(/;\s+/)) {
    const match = part.match(/^([^:;]*\p{L}[^:;]*):\s*(.+)$/u);
    if (!match) {
      if (part.trim()) rest.push(part.trim());
    } else if (isNotesColumn(match[1])) {
      rest.push(match[2].trim());
    } else if (!isCounterColumn(match[1])) {
      fields.push({ key: match[1], value: match[2] });
    }
  }
  return { fields: cleanFields(fields) ?? [], rest };
}

/** A note added under what is there, never over it, and not twice. */
export function appendNote(remark: string | undefined, note: string | undefined): string | undefined {
  const text = note?.trim();
  if (!text) return remark;
  if (!remark?.trim()) return text;
  return remark.includes(text) ? remark : `${remark.trimEnd()}\n${text}`;
}

export type ContactProblem = "phone_missing" | "phone_invalid" | "phone_not_mobile" | "phone_fake";

export type ContactFix =
  | "name_tidied"
  | "name_dropped"
  | "name_edited"
  | "email_dropped"
  | "birthday_dropped"
  | "company_tidied"
  | "business_name"
  | "do_not_contact";

export const PROBLEM_LABELS: Record<ContactProblem, string> = {
  phone_missing: "No phone number",
  phone_invalid: "Not a valid phone number",
  phone_not_mobile: "Not a mobile number",
  phone_fake: "Looks like a made-up number",
};

export const FIX_LABELS: Record<ContactFix, string> = {
  name_tidied: "Name tidied",
  name_dropped: "Name was not a name",
  name_edited: "Name edited",
  email_dropped: "Email was not valid",
  birthday_dropped: "Birthday could not be read",
  company_tidied: "Company tidied",
  business_name: "Business name moved to company",
  do_not_contact: "Asked not to be messaged",
};

const PLACEHOLDER_NAMES = new Set([
  "na", "n/a", "nil", "none", "null", "unknown", "test", "testing", "abc", "xyz",
  "customer", "user", "-", ".", "..", "?", "no name",
]);

const CHAT_WORD = /^(hi+|hel+o+w?|hl+o+|he+y+|hy|namaste|namaskar|ok|okay|thanks?|thanku|thankyou|bye)$/;
const GREETING = /\bgood (morning|afternoon|evening|night)\b/;

export function isProperName(raw: string | undefined): boolean {
  const text = raw?.replace(/[\s  -   　]+/g, " ").trim();
  if (!text) return false;
  if (/\p{Extended_Pictographic}/u.test(text)) return false;
  if (text.normalize("NFKC") !== text.normalize("NFC")) return false;
  if (!/^[\p{L}\p{M}‌‍ .'’-]+$/u.test(text)) return false;
  if ((text.match(/\p{L}/gu) ?? []).length < 2) return false;
  const lower = text.toLowerCase();
  if (PLACEHOLDER_NAMES.has(lower) || GREETING.test(lower)) return false;
  return !lower.split(/[ .'’-]+/).some((word) => CHAT_WORD.test(word));
}

function tidyText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "")
    .replace(/[_|*#~^<>[\]{}=\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase());
}

export function tidyName(raw: string | undefined): { value?: string; fix?: ContactFix } {
  if (!raw?.trim()) return {};
  const text = tidyText(raw);
  if (!/\p{L}/u.test(text) || PLACEHOLDER_NAMES.has(text.toLowerCase())) {
    return { fix: "name_dropped" };
  }
  const shouty = text === text.toUpperCase() || text === text.toLowerCase();
  const value = (shouty && /[a-z]/i.test(text) ? titleCase(text) : text).slice(0, 80);
  return { value, fix: value !== raw.trim() ? "name_tidied" : undefined };
}

/** A usable name made from what is left once emojis, symbols, digits and chat words go, or "". */
export function suggestName(raw: string | undefined): string {
  if (!raw) return "";
  const words = tidyText(raw)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{M}‌‍ .'’-]+/gu, " ")
    .split(" ")
    .filter((word) => word && !CHAT_WORD.test(word.toLowerCase()))
    .map((word) =>
      /^\p{Lu}?[\p{Ll}\p{M}]*$|^\p{Lu}[\p{Ll}\p{M}]+\p{Lu}[\p{Ll}\p{M}]+$/u.test(word) ? word : titleCase(word)
    );
  const name = tidyName(words.join(" ")).value ?? "";
  return isProperName(name) ? name : "";
}

function fakeDigits(local: string): boolean {
  if (/^(\d)\1+$/.test(local)) return true;
  return "01234567890".includes(local) || "09876543210".includes(local);
}

export function checkPhone(
  raw: string,
  countryCode: string | undefined
): { digits?: string; problem?: ContactProblem } {
  if (!raw.trim()) return { problem: "phone_missing" };
  const digits = normalisePhone(raw, countryCode);
  if (!digits) return { problem: "phone_invalid" };
  if (digits.startsWith("91")) {
    if (digits.length !== 12) return { problem: "phone_invalid" };
    if (!/^[6-9]/.test(digits.slice(2))) return { problem: "phone_not_mobile" };
  }
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (fakeDigits(local)) return { problem: "phone_fake" };
  return { digits };
}

export function splitTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;|]|:::/)
        .map((tag) =>
          tag
            .replace(/^\*\s*/, "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^\p{L}\p{N}\-_]/gu, "")
            .slice(0, 40)
        )
        .filter((tag) => tag && tag !== "mycontacts" && tag !== "starred")
    ),
  ].slice(0, 10);
}

export function cleanContact(
  raw: RawContact,
  countryCode: string | undefined
): { clean: CleanContact; problem?: ContactProblem; fixes: ContactFix[] } {
  const fixes: ContactFix[] = [];
  const phone = checkPhone(raw.phone, countryCode);

  const name = tidyName(raw.name);
  if (name.fix) fixes.push(name.fix);

  let email: string | undefined;
  if (raw.email?.trim()) {
    email = normaliseEmail(raw.email) ?? undefined;
    if (!email) fixes.push("email_dropped");
  }

  let birthday: string | undefined;
  if (raw.birthday?.trim()) {
    birthday = normaliseBirthday(raw.birthday) ?? undefined;
    if (!birthday) fixes.push("birthday_dropped");
  }

  let company: string | undefined;
  if (raw.company?.trim()) {
    company = tidyText(raw.company).slice(0, 80) || undefined;
    if (company !== raw.company.trim()) fixes.push("company_tidied");
  }

  const notes = raw.notes ? tidyText(raw.notes).slice(0, 600) || undefined : undefined;

  return {
    clean: {
      name: name.value,
      phone: phone.digits,
      email,
      company,
      birthday,
      tags: splitTags(raw.tags),
      notes,
      fields: cleanFields(raw.fields),
    },
    problem: phone.problem,
    fixes,
  };
}

export function describeForSorting(contact: CleanContact): string | null {
  const parts = [
    contact.name && `Name: ${contact.name}`,
    contact.company && `Company: ${contact.company}`,
    contact.email && `Email: ${contact.email}`,
    contact.tags.length > 0 && `Labels: ${contact.tags.join(", ")}`,
    ...(contact.fields ?? []).map((field) => `${field.key}: ${field.value}`),
    contact.notes && `Notes: ${contact.notes}`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join("\n");
}
