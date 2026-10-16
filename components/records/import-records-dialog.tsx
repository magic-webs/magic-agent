"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { parseCsv } from "@/lib/csv";
import { readXlsx } from "@/components/billing/xlsx";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

const BATCH = 200;
const SKIP = "skip";
const EXTRA = "extra";

type Book = Doc<"recordBooks">;
type Row = {
  values: Array<{ key: string; value: string }>;
  person?: { name?: string; phone?: string; email?: string; company?: string };
  stage?: string;
  notes?: string;
};

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

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
};

const IGNORED = new Set(["serial", "reference", "source", "filedby", "filedat", "updatedat"]);

function guessTarget(book: Book, header: string): string {
  const key = norm(header);
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

function toRows(headers: string[], body: string[][], targets: string[]): Row[] {
  return body
    .map((cells) => {
      const row: Row = { values: [] };
      const person: NonNullable<Row["person"]> = {};
      targets.forEach((target, index) => {
        const value = (cells[index] ?? "").trim();
        if (!value || target === SKIP) return;
        if (target.startsWith("field:")) {
          row.values.push({ key: target.slice(6), value });
        } else if (target.startsWith("person.")) {
          person[target.slice(7) as keyof typeof person] = value;
        } else if (target === "stage") {
          row.stage = value;
        } else if (target === "notes") {
          row.notes = value;
        } else {
          row.values.push({ key: headers[index].trim() || `column_${index + 1}`, value });
        }
      });
      if (Object.keys(person).length) row.person = person;
      return row;
    })
    .filter((row) => row.values.length || row.person || row.notes);
}

export function ImportRecordsDialog({ book }: { book: Book }) {
  const importRecords = useMutation(api.recordIntake.importRecords);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  const options = useMemo(
    () => [
      { value: SKIP, label: "Skip this column" },
      ...book.fields.map((field) => ({
        value: `field:${field.key}`,
        label: field.label,
      })),
      { value: "person.name", label: "Person · name" },
      { value: "person.phone", label: "Person · phone" },
      { value: "person.email", label: "Person · email" },
      { value: "person.company", label: "Person · company" },
      ...(book.stages.length ? [{ value: "stage", label: "Stage" }] : []),
      { value: "notes", label: "Notes" },
      { value: EXTRA, label: "Keep as an extra detail" },
    ],
    [book]
  );

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setBody([]);
    setTargets([]);
    setProgress(null);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const table = /\.xlsx$/i.test(file.name)
        ? await readXlsx(await file.arrayBuffer())
        : parseCsv(await file.text());
      const [head, ...rest] = table.filter((cells) => cells.some((cell) => cell.trim()));
      if (!head || rest.length === 0) {
        throw new Error("The file needs a header row and at least one row under it.");
      }
      setFileName(file.name);
      setHeaders(head);
      setBody(rest);
      setTargets(head.map((header) => guessTarget(book, header)));
    } catch (error) {
      reset();
      toast.add({
        title: "Could not read that file",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  const rows = useMemo(
    () => (headers.length ? toRows(headers, body, targets) : []),
    [headers, body, targets]
  );

  const missing = book.fields
    .filter((field) => field.required && !targets.includes(`field:${field.key}`))
    .map((field) => field.label);

  const run = async () => {
    let done = 0;
    setProgress(0);
    try {
      for (let start = 0; start < rows.length; start += BATCH) {
        await importRecords({ bookId: book._id, rows: rows.slice(start, start + BATCH) });
        done = Math.min(rows.length, start + BATCH);
        setProgress(done);
      }
      toast.add({
        title: `Imported ${rows.length} ${rows.length === 1 ? book.name.toLowerCase() : book.pluralName.toLowerCase()}`,
        type: "success",
      });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "The import stopped",
        description: `${done} of ${rows.length} were imported. ${friendlyError(error)}`,
        type: "error",
      });
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (progress !== null) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <UploadSimpleIcon /> Import
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {book.pluralName.toLowerCase()}</DialogTitle>
          <DialogDescription>
            A CSV or Excel file with a header row. Columns are matched to this
            book&apos;s fields by name — check the matches before importing. A
            file exported from this page imports back as it is.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">File</Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv,.xlsx"
              disabled={progress !== null}
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
            {fileName ? (
              <p className="text-xs text-muted-foreground">
                {fileName} · {body.length} row{body.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          {headers.length ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead className="hidden sm:table-cell">First row</TableHead>
                    <TableHead>Goes to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headers.map((header, index) => (
                    <TableRow key={index}>
                      <TableCell className="max-w-40 truncate font-medium">
                        {header || `Column ${index + 1}`}
                      </TableCell>
                      <TableCell className="hidden max-w-48 truncate text-muted-foreground sm:table-cell">
                        {body[0]?.[index] || "—"}
                      </TableCell>
                      <TableCell>
                        <SelectField
                          size="sm"
                          aria-label={`Where ${header || `column ${index + 1}`} goes`}
                          className="w-52"
                          value={targets[index]}
                          onValueChange={(next) =>
                            setTargets((prev) =>
                              prev.map((value, at) => (at === index ? next : value))
                            )
                          }
                          options={options}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {headers.length && missing.length ? (
            <p className="text-xs text-muted-foreground">
              No column for {missing.join(", ")}. Those rows are still imported,
              without it.
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" disabled={progress !== null} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={rows.length === 0 || progress !== null} onClick={run}>
            {progress !== null ? <Spinner /> : <UploadSimpleIcon />}
            {progress !== null
              ? `Importing ${progress} of ${rows.length}`
              : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
