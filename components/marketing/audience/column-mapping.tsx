"use client";

import {
  CONTACT_FIELDS,
  FIELD_KEY_MAX,
  columnNames,
  fieldKeysOf,
  mapContactRows,
  type ContactField,
  type ContactRow,
  type ContactTable,
} from "@/lib/contact-csv";
import { SelectField } from "@/components/select-field";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";

export function ColumnMapping({
  table,
  hasHeader,
  onHasHeader,
  mapping,
  onMapping,
}: {
  table: ContactTable;
  hasHeader: boolean;
  onHasHeader: (value: boolean) => void;
  mapping: ContactField[];
  onMapping: (mapping: ContactField[]) => void;
}) {
  const names = columnNames(table, hasHeader);
  const data = table.lines.slice(hasHeader ? 1 : 0);
  const samples = names.map((_, i) =>
    data
      .map((line) => line[i])
      .filter(Boolean)
      .slice(0, 3)
  );
  const filled = names.map((_, i) => data.filter((line) => line[i]).length);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Map columns</h3>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={hasHeader} onCheckedChange={(value) => onHasHeader(Boolean(value))} />
          First row is column names
        </label>
      </div>
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-36">Column in the file</TableHead>
              <TableHead className="hidden sm:table-cell">Sample values</TableHead>
              <TableHead className="w-44">Import as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {names.map((name, i) => (
              <TableRow key={i} className={mapping[i] === "skip" ? "opacity-60" : undefined}>
                <TableCell className="max-w-48 truncate font-medium">{name}</TableCell>
                <TableCell className="hidden max-w-72 sm:table-cell">
                  <span className="block truncate text-xs text-muted-foreground">
                    {samples[i].length ? samples[i].join(" · ") : "Empty"}
                  </span>
                  {filled[i] > 0 ? (
                    <span className="text-[11px] text-muted-foreground/80 tabular-nums">
                      {filled[i] === data.length
                        ? "Every row"
                        : `${filled[i].toLocaleString()} of ${data.length.toLocaleString()} rows`}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <SelectField
                    size="sm"
                    aria-label={`Import ${name} as`}
                    value={mapping[i] ?? "notes"}
                    options={CONTACT_FIELDS}
                    onValueChange={(value) =>
                      onMapping(mapping.map((field, j) => (j === i ? (value as ContactField) : field)))
                    }
                  />
                  {mapping[i] === "field" ? (
                    <span className="mt-1 block max-w-44 truncate text-[11px] text-muted-foreground">
                      Saved as “{name.trim().slice(0, FIELD_KEY_MAX)}”
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {mapping.includes("phone") ? null : (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5" /> Pick the column that holds phone numbers.
        </p>
      )}
    </div>
  );
}

const PREVIEW_COLUMNS: Array<{ key: Exclude<keyof ContactRow, "fields">; label: string }> = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "birthday", label: "Birthday" },
  { key: "tags", label: "Labels" },
  { key: "notes", label: "Notes" },
];

const EXAMPLES = 5;
const EXAMPLE_SCAN = 2000;

/**
 * A handful of rows that between them use every mapped column. The first rows
 * of a real file are often the sparse ones, and a preview built from them
 * says a column did nothing when it simply had no value there.
 */
function exampleRows(table: ContactTable, hasHeader: boolean, mapping: ContactField[]): ContactRow[] {
  const data = table.lines.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + EXAMPLE_SCAN);
  const wanted = mapping.flatMap((field, i) => (field === "skip" ? [] : [i]));
  const covered = new Set<number>();
  const picked: number[] = [];
  for (let row = 0; row < data.length && picked.length < EXAMPLES; row++) {
    const adds = wanted.filter((i) => data[row][i] && !covered.has(i));
    if (picked.length === 0 || adds.length > 0) {
      picked.push(row);
      for (const i of adds) covered.add(i);
    }
  }
  for (let row = 0; row < data.length && picked.length < EXAMPLES; row++) {
    if (!picked.includes(row)) picked.push(row);
  }
  picked.sort((a, b) => a - b);
  const lines = picked.map((row) => data[row]);
  return mapContactRows(
    { ...table, lines: hasHeader ? [table.lines[0], ...lines] : lines },
    hasHeader,
    mapping
  );
}

export function ImportPreview({
  table,
  hasHeader,
  mapping,
}: {
  table: ContactTable;
  hasHeader: boolean;
  mapping: ContactField[];
}) {
  const rows = exampleRows(table, hasHeader, mapping);
  if (rows.length === 0) return null;
  const shown = PREVIEW_COLUMNS.filter(({ key }) => rows.some((row) => row[key]));
  const fieldKeys = fieldKeysOf(rows);
  const fieldValue = (row: ContactRow, key: string) =>
    row.fields?.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">How rows will come in</h3>
      <p className="-mt-1 text-xs text-muted-foreground">
        A few rows from the file, picked so every column you mapped shows up.
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {shown.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
              {fieldKeys.map((key) => (
                <TableHead key={`field:${key}`} className="whitespace-nowrap">
                  {key}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                {shown.map((column) => (
                  <TableCell
                    key={column.key}
                    title={row[column.key] || undefined}
                    className="max-w-72 truncate text-xs"
                  >
                    {row[column.key] || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                ))}
                {fieldKeys.map((key) => (
                  <TableCell key={`field:${key}`} className="max-w-56 truncate text-xs">
                    {fieldValue(row, key) || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
