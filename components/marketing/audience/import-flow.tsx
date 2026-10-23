"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  FIX_LABELS,
  PROBLEM_LABELS,
  isProperName,
  suggestName,
  type ContactFix,
  type ContactProblem,
} from "@/convex/lib/contactClean";
import { downloadCsv } from "@/lib/csv";
import {
  guessMapping,
  mapContactRows,
  mergeRepeats,
  readContactTable,
  rowFromCells,
  sampleContactCsv,
  type ContactField,
  type ContactRow,
  type ContactTable,
} from "@/lib/contact-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BlockedIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CleanIcon,
  Download01Icon,
  PencilEdit02Icon,
  SparklesIcon,
  Tick02Icon,
  Undo02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { categoryLabel, categoryTone, fail, formatPhone, plural, type Category } from "./shared";
import { ColumnMapping, ImportPreview } from "./column-mapping";

const CHUNK = 500;
/** What one import holds; the server refuses more. */
const MAX_IMPORT = 10_000;
const CHECK_BATCH = 10;

type Source = "csv" | "paste";
type Bucket = "ready" | "check" | "invalid" | "duplicate" | "skipped";

const BUCKETS: Array<{ value: Bucket; label: string }> = [
  { value: "ready", label: "Ready" },
  { value: "check", label: "Needs a look" },
  { value: "invalid", label: "Problems" },
  { value: "duplicate", label: "Repeats" },
  { value: "skipped", label: "Left out" },
];
const BUCKET_WIDTHS = ["w-20", "w-32", "w-24", "w-24", "w-24"];
const ROW_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-20", "w-40"];

function parsePaste(text: string): ContactRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => rowFromCells(line.split(/[,;\t|]/)))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function ImportUpload({
  onStarted,
  onClose,
}: {
  onStarted: (importId: Id<"audienceImports">) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const create = useMutation(api.audienceImports.create);
  const addRows = useMutation(api.audienceImports.addRows);
  const startSorting = useMutation(api.audienceImports.startSorting);

  const [source, setSource] = useState<Source>("csv");
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<ContactTable | null>(null);
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<ContactField[]>([]);
  const [limit, setLimit] = useState<"all" | "first">("all");
  const [firstCount, setFirstCount] = useState(100);
  const [dropRepeats, setDropRepeats] = useState(true);
  const [dropNoPhone, setDropNoPhone] = useState(true);
  const [pasted, setPasted] = useState("");
  const [countryCode, setCountryCode] = useState("91");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const prepared = useMemo(() => {
    if (!table) return null;
    const mapped = mapContactRows(table, hasHeader, mapping);
    const taken = limit === "first" ? mapped.slice(0, Math.max(0, firstCount)) : mapped;
    const noPhone = taken.filter((row) => !row.phone).length;
    const kept = dropNoPhone ? taken.filter((row) => row.phone) : taken;
    const merged = mergeRepeats(kept, countryCode);
    return {
      total: mapped.length,
      taken: taken.length,
      noPhone,
      repeats: merged.removed,
      rows: dropRepeats ? merged.rows : kept,
    };
  }, [table, hasHeader, mapping, limit, firstCount, dropNoPhone, dropRepeats, countryCode]);

  const rows = source === "csv" ? (prepared?.rows ?? []) : parsePaste(pasted);
  const mapped = source === "paste" || mapping.includes("phone");
  const tooMany = rows.length > MAX_IMPORT;

  const readFile = async (file: File) => {
    const read = readContactTable(await file.text());
    const rowsInFile = read.lines.length - (read.hasHeader ? 1 : 0);
    setFileName(file.name);
    setTable(read);
    setHasHeader(read.hasHeader);
    setMapping(guessMapping(read, read.hasHeader));
    setLimit(rowsInFile > MAX_IMPORT ? "first" : "all");
    setFirstCount(Math.min(rowsInFile, rowsInFile > MAX_IMPORT ? MAX_IMPORT : 100));
    if (!name) setName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  };

  const start = async () => {
    setBusy("Uploading");
    try {
      const importId = await create({
        workspaceId: workspace._id,
        name: name.trim() || "Imported contacts",
        fileName: fileName ?? undefined,
        countryCode,
      });
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Uploading ${Math.min(i + CHUNK, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`);
        await addRows({
          importId,
          firstLine: i + 1,
          rows: rows.slice(i, i + CHUNK).map((row) => ({
            name: row.name,
            phone: row.phone,
            email: row.email,
            company: row.company,
            birthday: row.birthday,
            tags: row.tags,
            notes: row.notes,
          })),
        });
      }
      await startSorting({ importId });
      onStarted(importId);
    } catch (error) {
      fail("Could not start the import", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Bring in contacts</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Upload a CSV exported from another system — Google Contacts, Excel, a CRM, an old
          WhatsApp tool — or paste a list. Every row is cleaned up, checked and sorted by Agent Check, and
          nothing is saved until you have reviewed it.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <ol className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
          {["Upload", "Map columns", "Clean up", "Agent Check", "Review and save"].map((label, index) => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-name">Name this list</Label>
            <Input
              id="import-name"
              value={name}
              maxLength={80}
              placeholder="List name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-cc">Country code</Label>
            <Input
              id="import-cc"
              value={countryCode}
              inputMode="numeric"
              onChange={(event) => setCountryCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
        </div>

        <ToggleGroup
          value={[source]}
          onValueChange={(next) => next[0] && setSource(next[0] as Source)}
          variant="outline"
        >
          <ToggleGroupItem value="csv">
            <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} /> Upload a file
          </ToggleGroupItem>
          <ToggleGroupItem value="paste">Paste a list</ToggleGroupItem>
        </ToggleGroup>

        {source === "csv" ? (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center hover:bg-muted/40">
              <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {fileName ? fileName : "Choose a CSV file"}
              </span>
              <span className="text-xs text-muted-foreground">
                Google Contacts, Excel or any spreadsheet saved as CSV. You choose what each column
                is next.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {prepared
                  ? `${plural(prepared.total, "row")} in the file, in ${plural(table?.width ?? 0, "column")}.`
                  : "Only a phone column is needed. Name, email, company, birthday, labels and notes help sorting."}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadCsv("contacts-sample.csv", sampleContactCsv())}
              >
                <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Sample file
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Textarea
              rows={7}
              value={pasted}
              placeholder="One person per line: name, phone number, note"
              onChange={(event) => setPasted(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              One person a line. {plural(rows.length, "row")} with a number found.
            </span>
          </div>
        )}

        {source === "csv" && table && prepared ? (
          <>
            <ColumnMapping
              table={table}
              hasHeader={hasHeader}
              onHasHeader={(value) => {
                setHasHeader(value);
                setMapping(guessMapping(table, value));
              }}
              mapping={mapping}
              onMapping={setMapping}
            />

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Rows to import</h3>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  value={[limit]}
                  onValueChange={(next) => next[0] && setLimit(next[0] as "all" | "first")}
                  variant="outline"
                >
                  <ToggleGroupItem value="all" disabled={prepared.total > MAX_IMPORT}>
                    All {prepared.total.toLocaleString()} rows
                  </ToggleGroupItem>
                  <ToggleGroupItem value="first">First</ToggleGroupItem>
                </ToggleGroup>
                {limit === "first" ? (
                  <Input
                    type="number"
                    min={1}
                    max={Math.min(prepared.total, MAX_IMPORT)}
                    value={firstCount}
                    aria-label="How many rows"
                    className="h-8 w-28"
                    onChange={(event) =>
                      setFirstCount(Math.max(1, Math.min(MAX_IMPORT, Number(event.target.value) || 1)))
                    }
                  />
                ) : null}
                {prepared.total > MAX_IMPORT ? (
                  <span className="text-xs text-muted-foreground">
                    One import holds up to {MAX_IMPORT.toLocaleString()} contacts.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Basic cleaning</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground">
                  <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4 text-emerald-600" />
                  {table.tidiedCells > 0
                    ? `Extra spaces trimmed in ${plural(table.tidiedCells, "cell")}`
                    : "No extra spaces to trim"}
                  {table.emptyLines > 0 ? `, ${plural(table.emptyLines, "empty line")} left out` : ""}
                </li>
                <li>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={dropNoPhone} onCheckedChange={(next) => setDropNoPhone(Boolean(next))} />
                    Skip rows with no phone number ({prepared.noPhone.toLocaleString()})
                  </label>
                </li>
                <li>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={dropRepeats} onCheckedChange={(next) => setDropRepeats(Boolean(next))} />
                    Remove repeated numbers, keeping the first ({prepared.repeats.toLocaleString()})
                  </label>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                After upload every row is cleaned up again — numbers checked, names and companies
                tidied, emails that aren&apos;t valid dropped, test data flagged — and you review it all
                before anything is saved.
              </p>
            </div>

            {mapped ? <ImportPreview table={table} hasHeader={hasHeader} mapping={mapping} /> : null}
          </>
        ) : null}

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={consent} onCheckedChange={(next) => setConsent(Boolean(next))} />
          <span>
            These people agreed to hear from {workspace.name} on WhatsApp. Messaging people who did
            not opt in gets a WhatsApp number restricted.
          </span>
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onClose} disabled={Boolean(busy)}>
          Cancel
        </Button>
        {tooMany ? (
          <span className="mr-auto self-center text-xs text-destructive">
            One import holds up to {MAX_IMPORT.toLocaleString()} contacts — import the first{" "}
            {MAX_IMPORT.toLocaleString()} and the rest in another.
          </span>
        ) : null}
        <Button
          onClick={() => void start()}
          disabled={Boolean(busy) || rows.length === 0 || !consent || !mapped || tooMany}
        >
          {busy ? <Spinner /> : <HugeiconsIcon icon={CleanIcon} strokeWidth={2} />}
          {busy ?? `Clean up and sort ${plural(rows.length, "contact")}`}
        </Button>
      </div>
    </>
  );
}

export function ImportProgress({
  importId,
  onClose,
}: {
  importId: Id<"audienceImports">;
  onClose: () => void;
}) {
  const data = useQuery(api.audienceImports.get, { importId });

  if (data === undefined) return <ImportSkeleton />;

  const counts = data.counts;
  const recheck = data.mode === "recheck";
  const subject = recheck ? data.name.replace(/^Re-check: /, "") : data.name;
  if (data.status === "uploading" || data.status === "sorting") {
    const sorted = data.total - counts.queued;
    const batches = Math.ceil(data.total / CHECK_BATCH);
    return (
      <>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {recheck ? `Re-checking ${subject}` : `Agent Check is sorting ${data.name}`}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {recheck && data.status === "uploading"
              ? `Gathering contacts — ${plural(data.total, "contact")} so far. `
              : null}
            Contacts are checked in batches of {CHECK_BATCH} and placed in a category. You can leave
            this page — it carries on, and the list waits for you under Imports.
          </p>
        </div>
        <div className="flex flex-col gap-4 py-6">
          <Progress value={data.total ? Math.round((sorted / data.total) * 100) : 0} />
          <div className="flex items-center gap-2 text-sm">
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-4 text-primary" />
            {sorted.toLocaleString()} of {data.total.toLocaleString()} checked
            {batches > 0 ? (
              <span className="text-muted-foreground">
                · batch {Math.min(batches, Math.floor(sorted / CHECK_BATCH) + 1).toLocaleString()} of{" "}
                {batches.toLocaleString()}
              </span>
            ) : null}
          </div>
          <CountStrip counts={counts} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose}>
            Back to audience
          </Button>
        </div>
      </>
    );
  }

  if (data.status === "saving" || data.status === "saved") {
    const done = data.status === "saved";
    return (
      <>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {recheck
              ? done
                ? "Updated"
                : `Updating ${subject}`
              : done
                ? "Saved"
                : `Saving ${data.name}`}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {recheck
              ? done
                ? `${plural(counts.saved, "contact")} updated.`
                : "Updating everyone you kept with what Agent Check found."
              : done
                ? `${plural(counts.saved, "contact")} added to your audience${data.audienceId ? ` and to the list “${data.name}”` : ""}.`
                : "Adding everyone you kept to your contacts."}
          </p>
        </div>
        <div className="flex flex-col gap-4 py-6">
          {done ? (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-5" />
              Ready to use in campaigns and events.
            </div>
          ) : (
            <Progress
              value={Math.round((counts.saved / Math.max(1, counts.saved + counts.ready)) * 100)}
            />
          )}
          <CountStrip counts={counts} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>{done ? "Done" : "Back to audience"}</Button>
        </div>
      </>
    );
  }

  return <Review data={data} recheck={recheck} subject={subject} onClose={onClose} />;
}

function CountStrip({ counts }: { counts: Doc<"audienceImports">["counts"] }) {
  const items = [
    { label: "Ready", value: counts.ready + counts.saved, tone: "text-emerald-700 dark:text-emerald-400" },
    { label: "Needs a look", value: counts.check, tone: "text-amber-700 dark:text-amber-400" },
    { label: "Problems", value: counts.invalid, tone: "text-destructive" },
    { label: "Repeats", value: counts.duplicate, tone: "text-muted-foreground" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>
            {item.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

function ImportSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-1" aria-hidden>
        <Skeleton className="my-1 h-5 w-64 max-w-full" />
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-full max-w-xl" />
        </div>
      </div>
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {BUCKETS.map((item, i) => (
            <Skeleton key={item.value} className={`h-7 shrink-0 rounded-lg ${BUCKET_WIDTHS[i]}`} />
          ))}
        </div>
        <RowsSkeleton />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4" aria-hidden>
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>
    </>
  );
}

type ImportData = Doc<"audienceImports"> & { categories: Category[] };

function Review({
  data,
  recheck,
  subject,
  onClose,
}: {
  data: ImportData;
  recheck: boolean;
  subject: string;
  onClose: () => void;
}) {
  const save = useMutation(api.audienceImports.save);
  const discard = useMutation(api.audienceImports.discard);
  const acceptAll = useMutation(api.audienceImports.acceptAll);
  const [bucket, setBucket] = useState<Bucket>(data.counts.check > 0 ? "check" : "ready");
  const [listName, setListName] = useState(data.name);
  const [makeList, setMakeList] = useState(true);
  const [busy, setBusy] = useState(false);

  const counts = data.counts;
  const run = async (task: () => Promise<unknown>, title: string) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      fail(title, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {recheck ? `Re-checking ${subject}` : `Review ${data.name}`}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {recheck
            ? `${plural(data.total, "contact")} checked again. Fix names that would read badly in a message, change a category where it is wrong, leave out anyone you want untouched, then update.`
            : `${plural(data.total, "row")} cleaned up and sorted. Fix names that would read badly in a message, check anything else flagged, change a category where it is wrong, then save.`}
        </p>
      </div>
      <div className="flex min-h-0 flex-col gap-3">
        {data.error ? (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {data.error}
          </p>
        ) : null}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {BUCKETS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={bucket === item.value ? "secondary" : "ghost"}
              onClick={() => setBucket(item.value)}
            >
              {item.label}
              <Badge variant="outline" className="ml-1 tabular-nums">
                {counts[item.value].toLocaleString()}
              </Badge>
            </Button>
          ))}
          {bucket === "check" && counts.check > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void run(() => acceptAll({ importId: data._id, from: "check" }), "Could not keep them")
              }
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} /> Keep all {counts.check.toLocaleString()}
            </Button>
          ) : null}
          {bucket === "skipped" && counts.skipped > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void run(() => acceptAll({ importId: data._id, from: "skipped" }), "Could not restore them")
              }
            >
              <HugeiconsIcon icon={Undo02Icon} strokeWidth={2} /> Put all back
            </Button>
          ) : null}
        </div>
        <RowsTable
          key={bucket}
          importId={data._id}
          bucket={bucket}
          categories={data.categories}
          recheck={recheck}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4 flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {recheck ? (
          <span className="flex-1" />
        ) : (
          <label className="flex flex-1 items-center gap-2 text-sm">
            <Checkbox checked={makeList} onCheckedChange={(next) => setMakeList(Boolean(next))} />
            <span className="shrink-0">Also save as the list</span>
            <Input
              value={listName}
              disabled={!makeList}
              className="h-8 max-w-64"
              onChange={(event) => setListName(event.target.value)}
            />
          </label>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await discard({ importId: data._id });
              toast.add({ title: recheck ? "Re-check thrown away" : "Import thrown away" });
              onClose();
            }, "Could not discard it")
          }
        >
          Discard
        </Button>
        <Button
          disabled={busy || counts.ready === 0}
          onClick={() =>
            void run(
              () =>
                save({
                  importId: data._id,
                  audienceName: makeList && !recheck ? listName.trim() || data.name : undefined,
                }),
              "Could not save"
            )
          }
        >
          {busy ? <Spinner /> : <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />} {recheck ? "Update" : "Save"}{" "}
          {plural(counts.ready, "contact")}
        </Button>
      </div>
    </>
  );
}

function RowsTable({
  importId,
  bucket,
  categories,
  recheck,
}: {
  importId: Id<"audienceImports">;
  bucket: Bucket;
  categories: Category[];
  recheck: boolean;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.audienceImports.rows,
    { importId, status: bucket },
    { initialNumItems: 25 }
  );
  const updateRow = useMutation(api.audienceImports.updateRow);
  const setRowsStatus = useMutation(api.audienceImports.setRowsStatus);
  const options = categories.map((category) => ({ value: category.key, label: category.label }));

  if (status === "LoadingFirstPage") return <RowsSkeleton bucket={bucket} />;
  if (results.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        Nothing here.
      </p>
    );
  }

  return (
    <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Line</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="hidden md:table-cell">Details</TableHead>
            <TableHead className="w-48">{bucket === "invalid" ? "Fix the number" : "Category"}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((row) => (
            <TableRow key={row._id}>
              <TableCell className="text-xs text-muted-foreground tabular-nums">{row.line}</TableCell>
              <TableCell>
                <NameCell
                  name={row.name}
                  editable={bucket === "ready" || bucket === "check"}
                  openFirst={bucket === "check"}
                  onSave={(name) => updateRow({ rowId: row._id, name })}
                />
                <p className="font-mono text-xs text-muted-foreground">
                  {row.phone ? formatPhone(row.phone) : row.raw.phone || "—"}
                </p>
                {row.name && !isProperName(row.name) ? (
                  <Badge variant="outline" className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                    Not a clean name for messages
                  </Badge>
                ) : null}
                {row.optedOut ? (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    Unsubscribed earlier
                  </Badge>
                ) : row.existingContactId && !recheck ? (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    Already a contact
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="hidden max-w-72 md:table-cell">
                <p className="truncate text-xs text-muted-foreground">
                  {[row.company, row.email, row.notes].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.problem ? (
                    <Badge variant="destructive" className="text-[10px]">
                      {PROBLEM_LABELS[row.problem as ContactProblem] ?? row.problem}
                    </Badge>
                  ) : null}
                  {row.duplicateOfLine ? (
                    <Badge variant="outline" className="text-[10px]">
                      Same number as line {row.duplicateOfLine}
                    </Badge>
                  ) : null}
                  {(row.junk ?? 0) >= 0.5 ? (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                      Looks like test data
                    </Badge>
                  ) : null}
                  {row.confidence !== undefined && row.confidence < 0.8 ? (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                      Unsure · {Math.round(row.confidence * 100)}%
                    </Badge>
                  ) : null}
                  {row.fixes.map((fix) =>
                    fix === "business_name" || fix === "do_not_contact" ? (
                      <Badge
                        key={fix}
                        variant="outline"
                        className="gap-1 text-[10px] text-violet-700 dark:text-violet-300"
                      >
                        <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-3" />
                        {FIX_LABELS[fix]}
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            void updateRow({ rowId: row._id, undo: fix }).catch((error) =>
                              fail("Could not undo it", error)
                            )
                          }
                        >
                          undo
                        </button>
                      </Badge>
                    ) : (
                      <Badge key={fix} variant="secondary" className="text-[10px]">
                        {FIX_LABELS[fix as ContactFix] ?? fix}
                      </Badge>
                    )
                  )}
                </div>
              </TableCell>
              <TableCell>
                {bucket === "invalid" ? (
                  <PhoneFix
                    initial={row.raw.phone}
                    onSave={(phone) => updateRow({ rowId: row._id, phone })}
                  />
                ) : bucket === "duplicate" ? (
                  <span className="text-xs text-muted-foreground">Merged into line {row.duplicateOfLine}</span>
                ) : (
                  <div className="flex flex-col gap-1">
                    <SelectField
                      size="sm"
                      aria-label="Category"
                      value={row.category ?? ""}
                      placeholder="Pick one"
                      options={options}
                      onValueChange={(category) =>
                        void updateRow({ rowId: row._id, category }).catch((error) =>
                          fail("Could not change it", error)
                        )
                      }
                    />
                    <span
                      className={`w-fit rounded px-1.5 py-0.5 text-[10px] ${categoryTone(categories, row.category)}`}
                    >
                      {categoryLabel(categories, row.category)}
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                {bucket === "skipped" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void setRowsStatus({ rowIds: [row._id], status: "ready" }).catch((error) =>
                        fail("Could not put it back", error)
                      )
                    }
                  >
                    Put back
                  </Button>
                ) : bucket === "ready" || bucket === "check" ? (
                  <div className="flex justify-end gap-1">
                    {bucket === "check" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void setRowsStatus({ rowIds: [row._id], status: "ready" }).catch((error) =>
                            fail("Could not keep it", error)
                          )
                        }
                      >
                        Keep
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Leave out"
                      onClick={() =>
                        void setRowsStatus({ rowIds: [row._id], status: "skipped" }).catch((error) =>
                          fail("Could not leave it out", error)
                        )
                      }
                    >
                      <HugeiconsIcon icon={BlockedIcon} strokeWidth={2} />
                    </Button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {status === "CanLoadMore" ? (
        <div className="flex justify-center border-t border-border p-2">
          <Button size="sm" variant="ghost" onClick={() => loadMore(50)}>
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RowsSkeleton({ bucket }: { bucket?: Bucket }) {
  return (
    <div className="max-h-[65vh] overflow-auto rounded-md border border-border" aria-hidden>
      <Table>
        {bucket ? (
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Line</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
              <TableHead className="w-48">{bucket === "invalid" ? "Fix the number" : "Category"}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
        ) : null}
        <TableBody>
          {ROW_WIDTHS.map((width, i) => (
            <TableRow key={width}>
              <TableCell>
                <Skeleton className="h-3 w-5" />
              </TableCell>
              <TableCell>
                <div className="flex h-5 items-center">
                  <Skeleton className={`h-3.5 ${width}`} />
                </div>
                <Skeleton className="my-0.5 h-3 w-28" />
              </TableCell>
              <TableCell className="hidden max-w-72 md:table-cell">
                <Skeleton className={`my-0.5 h-3 ${i % 2 ? "w-32" : "w-48"}`} />
                <div className="mt-1 flex gap-1">
                  {i % 3 === 0 ? <Skeleton className="h-5 w-20 rounded-full" /> : null}
                </div>
              </TableCell>
              <TableCell>
                {bucket === "invalid" ? (
                  <div className="flex gap-1">
                    <Skeleton className="h-8 flex-1 rounded-lg" />
                    <Skeleton className="h-7 w-10 rounded-lg" />
                  </div>
                ) : bucket === "duplicate" ? (
                  <Skeleton className="h-3 w-32" />
                ) : (
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-7 w-28 rounded-lg" />
                    <Skeleton className={`h-4.5 rounded ${i % 2 ? "w-20" : "w-16"}`} />
                  </div>
                )}
              </TableCell>
              <TableCell>
                {bucket === "skipped" ? (
                  <Skeleton className="ml-auto h-7 w-20 rounded-lg" />
                ) : bucket === "invalid" || bucket === "duplicate" ? null : (
                  <div className="flex justify-end gap-1">
                    {bucket === "check" ? <Skeleton className="h-7 w-12 rounded-lg" /> : null}
                    <Skeleton className="size-7 rounded-lg" />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NameCell({
  name,
  editable,
  openFirst,
  onSave,
}: {
  name: string | undefined;
  editable: boolean;
  openFirst: boolean;
  onSave: (name: string) => Promise<unknown>;
}) {
  const unclean = Boolean(name) && !isProperName(name);
  const [editing, setEditing] = useState(editable && openFirst && unclean);
  const [value, setValue] = useState(() => suggestName(name) || name || "");
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <p className="font-medium">{name ?? <span className="text-muted-foreground">No name</span>}</p>
        {editable ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Edit name"
            className="text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex max-w-80 flex-col gap-1 py-0.5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave(value.trim());
          setEditing(false);
        } catch (error) {
          fail("Could not change the name", error);
        } finally {
          setBusy(false);
        }
      }}
    >
      {name ? <p className="truncate text-xs text-muted-foreground">Was: {name}</p> : null}
      <div className="flex gap-1">
        <Input
          autoFocus={!openFirst}
          value={value}
          aria-label="Name"
          placeholder="Their name"
          className="h-8"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
        />
        <Button size="sm" type="submit" disabled={busy || !value.trim() || value.trim() === name}>
          {busy ? <Spinner /> : "Save"}
        </Button>
        <Button size="icon-sm" type="button" variant="ghost" aria-label="Cancel" onClick={() => setEditing(false)}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>
    </form>
  );
}

function PhoneFix({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (phone: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-1"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
        } catch (error) {
          fail("Could not fix it", error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        value={value}
        className="h-8 font-mono text-xs"
        onChange={(event) => setValue(event.target.value)}
      />
      <Button size="sm" type="submit" variant="outline" disabled={busy || value === initial}>
        {busy ? <Spinner /> : "Fix"}
      </Button>
    </form>
  );
}

export function RecheckButton({ categories }: { categories: Category[] }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const recheck = useMutation(api.audienceImports.recheck);
  const audiences = useQuery(api.audience.list, { workspaceId: workspace._id });
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("everyone");
  const [busy, setBusy] = useState(false);

  const options = [
    { value: "everyone", label: "Everyone" },
    ...categories.map((category) => ({
      value: `category:${category.key}`,
      label: category.label,
    })),
    ...(audiences ?? []).map((audience) => ({
      value: `audience:${audience._id}`,
      label: `${audience.name} (${audience.memberCount.toLocaleString()})`,
    })),
  ];

  const start = async () => {
    setBusy(true);
    try {
      const importId = await recheck({
        workspaceId: workspace._id,
        ...(target.startsWith("category:") ? { category: target.slice(9) } : {}),
        ...(target.startsWith("audience:")
          ? { audienceId: target.slice(9) as Id<"audiences"> }
          : {}),
      });
      setOpen(false);
      router.push(`/w/${workspace.slug}/marketing/audience/import/${importId}`);
    } catch (error) {
      fail("Could not start the re-check", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} /> Re-check with Agent Check
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-check with Agent Check</DialogTitle>
            <DialogDescription>
              Agent Check sorts these contacts again. You review what it finds before anyone is
              updated.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recheck-target">Who to check</Label>
            <SelectField
              id="recheck-target"
              value={target}
              options={options}
              onValueChange={(next) => setTarget(next || "everyone")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void start()}>
              {busy ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />} Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
