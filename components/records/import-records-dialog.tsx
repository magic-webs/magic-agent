"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { parseCsv } from "@/lib/csv";
import { readXlsx } from "@/components/billing/xlsx";
import {
  applyTarget,
  guessTarget,
  savedTarget,
  targetOptions,
  type MappedRecord,
} from "@/convex/lib/recordMapping";
import { SelectField } from "@/components/select-field";
import { Checkbox } from "@/components/ui/checkbox";
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

type Book = Doc<"recordBooks">;

function toRows(headers: string[], body: string[][], targets: string[]): MappedRecord[] {
  return body
    .map((cells) => {
      const row: MappedRecord = { values: [] };
      targets.forEach((target, index) => {
        const source = headers[index].trim() || `column_${index + 1}`;
        applyTarget(row, target, source, cells[index] ?? "");
      });
      return row;
    })
    .filter((row) => row.values.length || row.person || row.notes);
}

export function ImportRecordsDialog({ book }: { book: Book }) {
  const importRecords = useMutation(api.recordIntake.importRecords);
  const saveMapping = useMutation(api.recordIntake.saveImportMapping);
  const [remember, setRemember] = useState(true);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  const options = useMemo(() => targetOptions(book), [book]);

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
      setTargets(
        head.map(
          (header) => savedTarget(book, book.importMapping, header) ?? guessTarget(book, header)
        )
      );
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
      if (remember) {
        await saveMapping({
          bookId: book._id,
          mapping: headers
            .map((header, index) => ({ source: header, target: targets[index] }))
            .filter((row) => row.source.trim()),
        });
      }
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
            A CSV or Excel file with a header row. Pick where each column goes —
            columns you mapped before line up on their own, the rest are matched
            by name. A file exported from this page imports back as it is.
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

          {headers.length ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              Remember this mapping for the next file
            </label>
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
