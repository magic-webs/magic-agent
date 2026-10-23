import { normaliseBirthday } from "@/convex/lib/marketing";
import { isCounterColumn, isNotesColumn } from "@/convex/lib/contactClean";
import { parseCsv, toCsv } from "./csv";

/**
 * The contacts CSV: what the Marketing page imports and exports.
 *
 *   name,phone,birthday,email,company
 *   Asha Rao,+91 98765 43210,25 Dec,asha@example.com,
 *
 * Only `phone` is needed. Columns are found by their header rather than their
 * position, and the headers Google Contacts and most spreadsheets write are
 * understood too — "Mobile", "Phone 1 - Value", "First Name" and "Last Name",
 * "Organization Name" — so an export from somewhere else imports as it is.
 * A file with no header row at all is read cell by cell instead: the number is
 * the cell that looks like one.
 */

/** One person, in the shape `contacts.addMany` accepts. */
export type ContactRow = {
  name?: string;
  phone: string;
  birthday?: string;
  email?: string;
  company?: string;
  tags?: string;
  notes?: string;
  /** Columns kept as their own fields on the contact, keyed by their header. */
  fields?: ContactFieldValue[];
};

export type ContactFieldValue = { key: string; value: string };

export type ContactParse = {
  rows: ContactRow[];
  /** Line numbers, as a spreadsheet counts them, that had no number. */
  missingPhone: number[];
  /** Whether the first line was read as column names. */
  hasHeader: boolean;
};

export const CONTACT_CSV_COLUMNS = ["name", "phone", "birthday", "email", "company"] as const;

type Field =
  | "name"
  | "first"
  | "last"
  | "phone"
  | "birthday"
  | "email"
  | "company"
  | "tags";

/** "Phone 1 - Value" → "phone 1 value". */
const clean = (header: string) =>
  header.toLowerCase().replace(/[_\-.:]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Which field a header names, if any. A column that describes another —
 * "Phone 1 - Type", "E-mail 1 - Label" — names none.
 */
function fieldOf(header: string): Field | null {
  const text = clean(header);
  if (!text || /\b(type|label)\b/.test(text)) return null;
  if (/^(tags?|labels|groups?|segments?|categor(y|ies))$/.test(text)) return "tags";
  if (/^(first|given) name$/.test(text)) return "first";
  if (/^(last|family|sur) ?name$/.test(text)) return "last";
  if (/\b(phone|mobile|whatsapp|cell|tel|telephone|contact number)\b/.test(text) || text === "number") {
    return "phone";
  }
  if (/\be ?mail\b/.test(text)) return "email";
  if (/\b(birthday|birth date|date of birth|dob)\b/.test(text)) return "birthday";
  if (/\b(company|organi[sz]ation|business|firm)\b/.test(text) && !/\btitle\b/.test(text)) {
    return "company";
  }
  // A bare "Contact" is left out on purpose: in half the sheets it holds the
  // number and in the other half the name, and the cell-by-cell reading
  // below gets both right.
  if (/^(name|full name|display name|customer|customer name|contact name)$/.test(text)) {
    return "name";
  }
  return null;
}

/** A cell that reads as a phone number: mostly digits, and enough of them. */
export const looksLikePhone = (cell: string) =>
  /^[+\d\s().-]+$/.test(cell.trim()) && (cell.match(/\d/g) ?? []).length >= 8;

/**
 * One person from cells in no known order: the number is the cell that looks
 * like one, a birthday is a cell that reads as a day of the year, an email has
 * an @, and the name is the first thing left with letters in it.
 */
export function rowFromCells(cells: string[]): ContactRow | null {
  const values = cells.map((cell) => cell.trim()).filter(Boolean);
  const phone = values.find(looksLikePhone);
  if (!phone) return null;
  const rest = values.filter((cell) => cell !== phone);
  const email = rest.find((cell) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell));
  const birthday = rest.find((cell) => cell !== email && normaliseBirthday(cell) !== null);
  const name = rest.find(
    (cell) => cell !== email && cell !== birthday && /\p{L}/u.test(cell)
  );
  const notes = rest.filter((cell) => cell !== email && cell !== birthday && cell !== name);
  return { phone, name, birthday, email, notes: notes.join("; ") || undefined };
}

export function parseContactCsv(text: string): ContactParse {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (table.length === 0) return { rows: [], missingPhone: [], hasHeader: false };

  const fields = table[0].map(fieldOf);
  const hasHeader = fields.includes("phone");
  const rows: ContactRow[] = [];
  const missingPhone: number[] = [];

  table.slice(hasHeader ? 1 : 0).forEach((cells, index) => {
    const line = index + (hasHeader ? 2 : 1);
    if (!hasHeader) {
      const row = rowFromCells(cells);
      if (row) rows.push(row);
      // A first line with no number in a file whose headers were not
      // recognised is a header row all the same — "Name, Contact" — not a
      // person missing their number.
      else if (index > 0) missingPhone.push(line);
      return;
    }

    // The first column of each kind wins: a Google export has "Phone 1" and
    // "Phone 2", and the first is the one people mean.
    const pick = (field: Field) => {
      for (let i = 0; i < fields.length; i++) {
        if (fields[i] === field && cells[i]?.trim()) return cells[i].trim();
      }
      return undefined;
    };
    // Google writes several numbers into one cell as "a ::: b".
    const phone = pick("phone")?.split(":::")[0].trim();
    if (!phone) {
      missingPhone.push(line);
      return;
    }
    const joined = [pick("first"), pick("last")].filter(Boolean).join(" ");
    const notes = table[0]
      .map((header, i) =>
        fields[i] === null && header.trim() && cells[i]?.trim()
          ? `${header.trim()}: ${cells[i].trim()}`
          : null
      )
      .filter(Boolean)
      .join("; ");
    rows.push({
      phone,
      name: pick("name") ?? (joined || undefined),
      birthday: pick("birthday"),
      email: pick("email"),
      company: pick("company"),
      tags: pick("tags"),
      notes: notes || undefined,
    });
  });

  return { rows, missingPhone, hasHeader };
}

/** What one column of an imported file becomes. */
export type ContactField = Field | "field" | "notes" | "skip";

export const CONTACT_FIELDS: Array<{ value: ContactField; label: string }> = [
  { value: "phone", label: "Phone" },
  { value: "name", label: "Name" },
  { value: "first", label: "First name" },
  { value: "last", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "company", label: "Company" },
  { value: "birthday", label: "Birthday" },
  { value: "field", label: "Own column" },
  { value: "tags", label: "Labels" },
  { value: "notes", label: "Add to notes" },
  { value: "skip", label: "Don't import" },
];

export const FIELD_KEY_MAX = 40;

/** A contacts file as read, before anyone says what its columns are. */
export type ContactTable = {
  /** Every line with something in it, each cell's spaces tidied. */
  lines: string[][];
  width: number;
  /** Blank lines between the ones with something in them. */
  emptyLines: number;
  /** Cells that had spaces at either end, or runs of them inside. */
  tidiedCells: number;
  /** Whether the first line reads as column names. */
  hasHeader: boolean;
};

export function readContactTable(text: string): ContactTable {
  const lines: string[][] = [];
  let emptyLines = 0;
  let pendingEmpty = 0;
  let tidiedCells = 0;
  for (const raw of parseCsv(text)) {
    const cells = raw.map((cell) => {
      const tidy = cell.replace(/\s+/g, " ").trim();
      if (tidy !== cell) tidiedCells++;
      return tidy;
    });
    if (!cells.some(Boolean)) {
      pendingEmpty++;
      continue;
    }
    // Only blanks with something after them count; a file's trailing
    // newline is not an empty row.
    if (lines.length > 0) emptyLines += pendingEmpty;
    pendingEmpty = 0;
    lines.push(cells);
  }
  const first = lines[0] ?? [];
  // A first line with no number above lines that have one is a header even
  // when its names are not recognised — "Name, Contact".
  const hasHeader =
    first.map(fieldOf).includes("phone") ||
    (lines.length > 1 && !first.some(looksLikePhone) && lines.slice(1, 6).some((line) => line.some(looksLikePhone)));
  return { lines, width: Math.max(0, ...lines.map((line) => line.length)), emptyLines, tidiedCells, hasHeader };
}

export function columnNames(table: ContactTable, hasHeader: boolean): string[] {
  return Array.from(
    { length: table.width },
    (_, i) => (hasHeader ? table.lines[0]?.[i] : "") || `Column ${i + 1}`
  );
}

const isEmail = (cell: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell);

/**
 * A starting mapping: each column by its header, and a column whose header
 * says nothing by what its values look like. Anything left keeps its own
 * column under its header, or goes to notes when the file has no header to
 * name it by.
 */
export function guessMapping(table: ContactTable, hasHeader: boolean): ContactField[] {
  const names = columnNames(table, hasHeader);
  const sample = table.lines.slice(hasHeader ? 1 : 0, 50);
  const share = (i: number, test: (cell: string) => boolean) => {
    const values = sample.map((line) => line[i] ?? "").filter(Boolean);
    return values.length ? values.filter(test).length / values.length : 0;
  };

  const fields: Array<ContactField | null> = names.map((name) => (hasHeader ? fieldOf(name) : null));
  const taken = new Set<ContactField>(fields.filter((field): field is ContactField => field !== null));
  if (taken.has("first") || taken.has("last")) taken.add("name");

  return fields.map((field, i) => {
    if (field) return field;
    // "Phone 1 - Label: Mobile" describes another column; it is not worth a note.
    if (hasHeader && /\b(type|label)\b/.test(clean(names[i]))) return "skip";
    if (hasHeader && isCounterColumn(names[i])) return "skip";
    if (hasHeader && isNotesColumn(names[i])) return "notes";
    const guess: ContactField | null =
      !taken.has("phone") && share(i, looksLikePhone) >= 0.6
        ? "phone"
        : !taken.has("email") && share(i, isEmail) >= 0.6
          ? "email"
          : !taken.has("birthday") && share(i, (cell) => normaliseBirthday(cell) !== null) >= 0.6
            ? "birthday"
            : !taken.has("name") && share(i, (cell) => /\p{L}/u.test(cell) && !looksLikePhone(cell)) >= 0.6
              ? "name"
              : null;
    if (guess) {
      taken.add(guess);
      return guess;
    }
    return hasHeader ? "field" : "notes";
  });
}

/**
 * Every line as a contact, by the mapping chosen. A line with no number keeps
 * an empty phone, so the caller decides whether it goes or is fixed later.
 */
export function mapContactRows(
  table: ContactTable,
  hasHeader: boolean,
  mapping: ContactField[]
): ContactRow[] {
  const names = columnNames(table, hasHeader);
  return table.lines.slice(hasHeader ? 1 : 0).map((cells) => {
    // The first column of each kind with something in it wins, as a Google
    // export's "Phone 1" over its "Phone 2".
    const pick = (field: ContactField) => {
      for (let i = 0; i < mapping.length; i++) {
        if (mapping[i] === field && cells[i]) return cells[i];
      }
      return undefined;
    };
    const joined = [pick("first"), pick("last")].filter(Boolean).join(" ");
    // Every column set to labels adds to them. One that is not a labels column
    // of its own — "Gender", "Religion" — names its values, so "H" arrives as
    // "religion-h" rather than a tag nobody can place.
    const tags = mapping
      .flatMap((field, i) => {
        if (field !== "tags" || !cells[i]) return [];
        const prefix = hasHeader && fieldOf(names[i]) !== "tags" ? `${names[i]} ` : "";
        return cells[i]
          .split(/[,;|]|:::/)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => `${prefix}${value}`);
      })
      .join(", ");
    const notes = mapping
      .map((field, i) =>
        field === "notes" && cells[i]
          ? hasHeader && !isNotesColumn(names[i])
            ? `${names[i]}: ${cells[i]}`
            : cells[i]
          : null
      )
      .filter(Boolean)
      .join("; ");
    const fields: ContactFieldValue[] = [];
    mapping.forEach((field, i) => {
      const key = names[i].trim().slice(0, FIELD_KEY_MAX);
      if (field !== "field" || !cells[i] || !key) return;
      if (fields.some((entry) => entry.key.toLowerCase() === key.toLowerCase())) return;
      fields.push({ key, value: cells[i] });
    });
    return {
      // Google writes several numbers into one cell as "a ::: b".
      phone: pick("phone")?.split(":::")[0].trim() ?? "",
      name: pick("name") ?? (joined || undefined),
      email: pick("email"),
      company: pick("company"),
      birthday: pick("birthday"),
      tags: tags || undefined,
      notes: notes || undefined,
      fields: fields.length ? fields : undefined,
    };
  });
}

/** The same number however it was written: "098765 43210" is "+91 98765 43210". */
function phoneKey(phone: string, countryCode: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length === 10 ? `${countryCode}${digits}` : digits;
}

/**
 * One row per number, the first kept and filled in from its repeats — a
 * second line that has the email the first was missing is not thrown away.
 */
export function mergeRepeats(
  rows: ContactRow[],
  countryCode: string
): { rows: ContactRow[]; removed: number } {
  const seen = new Map<string, ContactRow>();
  const kept: ContactRow[] = [];
  let removed = 0;
  for (const row of rows) {
    const key = row.phone ? phoneKey(row.phone, countryCode) : "";
    const first = key ? seen.get(key) : undefined;
    if (!first) {
      const copy = { ...row };
      if (key) seen.set(key, copy);
      kept.push(copy);
      continue;
    }
    removed++;
    for (const field of ["name", "email", "company", "birthday"] as const) {
      if (!first[field] && row[field]) first[field] = row[field];
    }
    if (row.tags) first.tags = [first.tags, row.tags].filter(Boolean).join(", ");
    if (row.notes && !first.notes?.includes(row.notes)) {
      first.notes = [first.notes, row.notes].filter(Boolean).join("; ");
    }
    if (row.fields) {
      const have = new Set((first.fields ?? []).map((entry) => entry.key.toLowerCase()));
      const added = row.fields.filter((entry) => !have.has(entry.key.toLowerCase()));
      if (added.length) first.fields = [...(first.fields ?? []), ...added];
    }
  }
  return { rows: kept, removed };
}

/** A file to fill in, showing each column the way it can be written. */
export function sampleContactCsv(): string {
  return toCsv([
    [...CONTACT_CSV_COLUMNS],
    ["Asha Rao", "+91 98765 43210", "25 Dec", "asha@example.com", ""],
    ["Vikram Singh", "91234 56789", "14/03", "", ""],
    ["Meera", "98111 22233", "", "", "Meera Boutique"],
  ]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A stored number as a spreadsheet should keep it. An Indian number is
 * spaced the way it is written, which also stops Excel reading twelve digits
 * as 9.19877E+11 and losing them on the next save.
 */
export function phoneCell(digits: string): string {
  if (/^91\d{10}$/.test(digits)) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** Every field key the contacts have, in the order they first appear. */
export function fieldKeysOf(contacts: Array<{ fields?: ContactFieldValue[] | null }>): string[] {
  const keys = new Map<string, string>();
  for (const contact of contacts) {
    for (const entry of contact.fields ?? []) {
      const id = entry.key.trim().toLowerCase();
      if (id && !keys.has(id)) keys.set(id, entry.key.trim());
    }
  }
  return [...keys.values()];
}

export function contactsToCsv(
  contacts: Array<{
    name?: string | null;
    phone: string;
    birthday?: string | null;
    email?: string | null;
    company?: string | null;
    notes?: string | null;
    fields?: ContactFieldValue[] | null;
  }>,
  fieldKeys: string[] = []
): string {
  const valueOf = (fields: ContactFieldValue[] | null | undefined, key: string) =>
    fields?.find((entry) => entry.key.trim().toLowerCase() === key.toLowerCase())?.value ?? "";
  return toCsv([
    [...CONTACT_CSV_COLUMNS, "notes", ...fieldKeys],
    ...contacts.map((contact) => [
      contact.name ?? "",
      phoneCell(contact.phone.replace(/\D/g, "")),
      // "MM-DD" stored; "25 Dec" written, which reads well and imports back.
      contact.birthday
        ? `${Number(contact.birthday.slice(3))} ${MONTHS[Number(contact.birthday.slice(0, 2)) - 1]}`
        : "",
      contact.email ?? "",
      contact.company ?? "",
      contact.notes ?? "",
      ...fieldKeys.map((key) => valueOf(contact.fields, key)),
    ]),
  ]);
}
