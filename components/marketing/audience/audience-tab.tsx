"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { ExportContactsButton } from "@/components/marketing/export-contacts-button";
import { SelectField } from "@/components/select-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
  CalendarLock01Icon,
  CleanIcon,
  Delete02Icon,
  FileImportIcon,
  LeftToRightListBulletIcon,
  NotificationOff01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  Tag01Icon,
  UserAdd01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { isBuiltIn } from "@/convex/lib/audience";
import { PersonDialog, type Person } from "./person-dialog";
import { CategoryDialog, MAX_CATEGORIES, WeeklyLimitDialog, weeklyLimitLabel } from "./settings-dialog";
import { RecheckButton } from "./import-flow";
import {
  categoryDot,
  categoryLabel,
  categoryTone,
  countText,
  fail,
  formatPhone,
  plural,
  type Category,
} from "./shared";

type View =
  | { kind: "all" }
  | { kind: "category"; key: string }
  | { kind: "audience"; id: Id<"audiences">; name: string }
  | { kind: "unsubscribed" };

const IMPORT_STATUS: Record<string, string> = {
  uploading: "Uploading",
  sorting: "Sorting",
  review: "Waiting for review",
  saving: "Saving",
  saved: "Saved",
};

const MAX_SELECTED = 500;
const PAGE_SIZE = 50;
const CONFIRM_INCOMPLETE_AT = 10;
const AUTO = "__auto";
const CONTACT_WIDTHS = ["w-32", "w-24", "w-40", "w-28", "w-36", "w-20"];

function viewKey(view: View): string {
  if (view.kind === "category") return `category:${view.key}`;
  if (view.kind === "audience") return `audience:${view.id}`;
  return view.kind;
}

export function AudienceTab({
  categories,
  weeklyCap,
  reachable,
  optedOut,
  capped,
  onAddByHand,
  birthdays,
}: {
  categories: Category[];
  weeklyCap: number;
  reachable: number;
  optedOut: number;
  capped: boolean;
  onAddByHand: () => void;
  birthdays: ReactNode;
}) {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>({ kind: "all" });
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<Id<"contacts">>>(new Set());
  const [person, setPerson] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const importBase = `/w/${workspace.slug}/marketing/audience/import`;
  const [categoryDialog, setCategoryDialog] = useState<{ editing: Category | null } | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);

  const audiences = useQuery(api.audience.list, { workspaceId: workspace._id });
  const imports = useQuery(api.audienceImports.list, { workspaceId: workspace._id });
  const summary = useQuery(api.audience.tags, { workspaceId: workspace._id });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const people = usePaginatedQuery(
    api.audience.people,
    {
      workspaceId: workspace._id,
      search: search || undefined,
      tag: tag || undefined,
      ...(view.kind === "category" ? { category: view.key } : {}),
      ...(view.kind === "audience" ? { audienceId: view.id } : {}),
      ...(view.kind === "unsubscribed" ? { subscription: "unsubscribed" as const } : {}),
    },
    { initialNumItems: PAGE_SIZE }
  );

  const loadMoreRow = useRef<HTMLTableRowElement>(null);
  const { status: peopleStatus, loadMore: loadMorePeople } = people;
  useEffect(() => {
    const node = loadMoreRow.current;
    if (!node || peopleStatus !== "CanLoadMore") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMorePeople(PAGE_SIZE);
      },
      { root: node.closest("[data-slot=table-container]"), rootMargin: "0px 0px 240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [peopleStatus, loadMorePeople]);

  const updatePeople = useMutation(api.audience.updatePeople);
  const createAudience = useMutation(api.audience.create);
  const addPeople = useMutation(api.audience.addPeople);
  const removePeople = useMutation(api.audience.removePeople);
  const removeAudience = useMutation(api.audience.remove);

  const choose = (next: View) => {
    setView(next);
    setSelected(new Set());
  };
  const chooseKey = (key: string) => {
    if (key === "all" || key === "unsubscribed") return choose({ kind: key });
    if (key.startsWith("category:")) return choose({ kind: "category", key: key.slice(9) });
    const audience = audiences?.find((row) => `audience:${row._id}` === key);
    if (audience) choose({ kind: "audience", id: audience._id, name: audience.name });
  };
  const pick = (next: Set<Id<"contacts">>) => {
    if (next.size > MAX_SELECTED) {
      toast.add({
        title: `Pick up to ${MAX_SELECTED} at a time`,
        description: `The first ${MAX_SELECTED} are selected. Act on them, then pick the rest.`,
      });
      setSelected(new Set([...next].slice(0, MAX_SELECTED)));
      return;
    }
    setSelected(next);
  };
  const ids = [...selected];
  const bulk = async (task: () => Promise<unknown>, done: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
      toast.add({ title: done, type: "success" });
      setSelected(new Set());
      return true;
    } catch (error) {
      fail("Could not do that", error);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const deleteList = (withContacts: boolean) => {
    if (view.kind !== "audience") return;
    const audienceId = view.id;
    const done = withContacts ? "List deleted. Its contacts are being removed." : "List deleted";
    void bulk(() => removeAudience({ audienceId, withContacts }), done).then((ok) => {
      setDeleting(false);
      if (ok) choose({ kind: "all" });
    });
  };
  const move = (category: string) =>
    void bulk(
      () => updatePeople({ workspaceId: workspace._id, contactIds: ids, category }),
      category
        ? `Moved ${plural(ids.length, "contact")}`
        : `${plural(ids.length, "contact")} sorted automatically`
    );

  const pending = (imports ?? []).filter((row) => row.status !== "saved");
  const rows = people.results;
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row._id));
  const filtered = Boolean(search || tag) || view.kind !== "all";
  const more = people.status === "CanLoadMore" || people.status === "LoadingMore";
  const categoryCount = (key: string) =>
    summary?.categories[key] !== undefined
      ? countText(summary.categories[key], summary.capped)
      : undefined;
  const viewOptions = [
    { value: "all", label: "All contacts" },
    { value: "unsubscribed", label: `Unsubscribed (${countText(optedOut, capped)})` },
    ...categories.map((category) => {
      const count = categoryCount(category.key);
      return {
        value: `category:${category.key}`,
        label: count ? `${category.label} (${count})` : category.label,
      };
    }),
    ...(audiences ?? []).map((audience) => ({
      value: `audience:${audience._id}`,
      label: `${audience.name} (${audience.memberCount.toLocaleString()})`,
    })),
  ];
  const canAddCategory = categories.filter((category) => !isBuiltIn(category.key)).length < MAX_CATEGORIES;
  const newCategory = () => setCategoryDialog({ editing: null });
  const viewedCategory =
    view.kind === "category" && !isBuiltIn(view.key)
      ? categories.find((category) => category.key === view.key)
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Header>
        <Button variant="outline" onClick={() => setLimitOpen(true)}>
          <HugeiconsIcon icon={CalendarLock01Icon} strokeWidth={2} /> {weeklyLimitLabel(weeklyCap)}
        </Button>
        <ExportContactsButton
          reachable={countText(reachable, capped)}
          optedOut={countText(optedOut, capped)}
          categories={categories.map((category) => ({
            key: category.key,
            label: category.label,
            count: categoryCount(category.key),
          }))}
          lists={(audiences ?? []).map((audience) => ({
            id: audience._id,
            name: audience.name,
            count: audience.memberCount.toLocaleString(),
          }))}
        />
        <Button variant="outline" onClick={onAddByHand}>
          <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} /> Add by hand
        </Button>
        <RecheckButton categories={categories} />
        <Button nativeButton={false} render={<Link href={importBase} />}>
          <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} /> Import contacts
        </Button>
      </Header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Can be messaged" value={countText(reachable, capped)} />
        <Tile label="Unsubscribed" value={countText(optedOut, capped)} />
        <Tile
          label="Lists"
          value={audiences === undefined ? undefined : countText(audiences.length, false)}
        />
        <Tile
          label="Complete contacts"
          value={summary === undefined ? undefined : countText(summary.categories.valid ?? 0, summary.capped)}
        />
      </div>

      {pending.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Imports</p>
          {pending.map((row) => (
            <Link
              key={row._id}
              href={`${importBase}/${row._id}`}
              className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
            >
              {row.status === "sorting" || row.status === "saving" ? <Spinner /> : <HugeiconsIcon icon={CleanIcon} strokeWidth={2} className="size-4 text-primary" />}
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.mode === "recheck" ? row.name.replace(/^Re-check: /, "") : row.name}
              </span>
              {row.mode === "recheck" ? <Badge variant="secondary">Re-check</Badge> : null}
              <span className="text-xs text-muted-foreground">
                {plural(row.total, row.mode === "recheck" ? "contact" : "row")}
              </span>
              <Badge variant={row.status === "review" ? "default" : "outline"}>
                {IMPORT_STATUS[row.status] ?? row.status}
              </Badge>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex gap-2 lg:hidden">
          <SelectField
            aria-label="Show"
            className="w-full"
            value={viewKey(view)}
            onValueChange={chooseKey}
            options={viewOptions}
          />
          <Button variant="outline" size="icon" aria-label="New category" disabled={!canAddCategory} onClick={newCategory}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          </Button>
        </div>
        <nav className="hidden flex-col gap-3 lg:flex">
          <RailGroup title="Everyone">
            <RailItem active={view.kind === "all"} onClick={() => choose({ kind: "all" })} icon={<HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />}>
              All contacts
            </RailItem>
            <RailItem
              active={view.kind === "unsubscribed"}
              onClick={() => choose({ kind: "unsubscribed" })}
              icon={<HugeiconsIcon icon={NotificationOff01Icon} strokeWidth={2} />}
              count={countText(optedOut, capped)}
            >
              Unsubscribed
            </RailItem>
          </RailGroup>
          <RailGroup
            title="Categories"
            action={
              <Button
                variant="ghost"
                size="icon-xs"
                className="-my-1"
                aria-label="New category"
                title={canAddCategory ? "New category" : `Up to ${MAX_CATEGORIES} categories of your own`}
                disabled={!canAddCategory}
                onClick={newCategory}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              </Button>
            }
          >
            {categories.map((category) => (
              <RailItem
                key={category.key}
                active={view.kind === "category" && view.key === category.key}
                onClick={() => choose({ kind: "category", key: category.key })}
                icon={<span className={`size-2.5 rounded-full ${categoryDot(categories, category.key)}`} />}
                count={categoryCount(category.key)}
              >
                {category.label}
              </RailItem>
            ))}
          </RailGroup>
          <RailGroup title="Lists">
            {audiences === undefined ? (
              <RailSkeleton widths={["w-24", "w-32"]} />
            ) : audiences.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Lists come from imports, or pick people and save them as one.
              </p>
            ) : (
              audiences.map((audience) => (
                <RailItem
                  key={audience._id}
                  active={view.kind === "audience" && view.id === audience._id}
                  onClick={() => choose({ kind: "audience", id: audience._id, name: audience.name })}
                  icon={<HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} />}
                  count={audience.memberCount.toLocaleString()}
                >
                  {audience.name}
                </RailItem>
              ))
            )}
          </RailGroup>
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-72">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchDraft}
                placeholder="Search name, number, company"
                aria-label="Search contacts"
                className="pl-8"
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  setSelected(new Set());
                }}
              />
            </div>
            <SelectField
              aria-label="Tag"
              className="w-44"
              value={tag}
              placeholder="Any tag"
              onValueChange={(next) => {
                setTag(next);
                setSelected(new Set());
              }}
              options={[
                { value: "", label: "Any tag" },
                ...(summary?.tags ?? []).map((row) => ({ value: row.tag, label: `${row.tag} (${row.count})` })),
              ]}
            />
            {view.kind === "audience" ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete list
              </Button>
            ) : null}
            {viewedCategory ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setCategoryDialog({ editing: viewedCategory })}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} /> Edit category
              </Button>
            ) : null}
          </div>

          {selected.size > 0 ? (
            <BulkBar
              count={selected.size}
              busy={busy}
              categories={categories}
              inList={view.kind === "audience"}
              onCategory={(category) => {
                if (category === "invalid" && ids.length >= CONFIRM_INCOMPLETE_AT) setPendingMove(category);
                else move(category);
              }}
              onTag={(value) =>
                void bulk(
                  () => updatePeople({ workspaceId: workspace._id, contactIds: ids, addTags: [value] }),
                  `Tagged ${plural(ids.length, "contact")}`
                )
              }
              onNewList={(name) =>
                void bulk(
                  () => createAudience({ workspaceId: workspace._id, name, contactIds: ids }),
                  `List “${name}” created`
                )
              }
              onAddToList={(audienceId) =>
                void bulk(() => addPeople({ audienceId, contactIds: ids }), "Added to the list")
              }
              onRemoveFromList={
                view.kind === "audience"
                  ? () => void bulk(() => removePeople({ audienceId: view.id, contactIds: ids }), "Removed from the list")
                  : undefined
              }
              audiences={(audiences ?? []).map((a) => ({ value: a._id, label: a.name }))}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          {people.status === "LoadingFirstPage" ? (
            <ContactsSkeleton />
          ) : rows.length === 0 && more ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>No matches yet</EmptyTitle>
                <EmptyDescription>Only part of your contacts has been checked so far.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  disabled={people.status === "LoadingMore"}
                  onClick={() => people.loadMore(PAGE_SIZE)}
                >
                  {people.status === "LoadingMore" ? <Spinner /> : null} Keep looking
                </Button>
              </EmptyContent>
            </Empty>
          ) : rows.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>{filtered ? "Nobody matches" : "Nobody here yet"}</EmptyTitle>
                <EmptyDescription>
                  {search || tag
                    ? "Try another search or tag."
                    : filtered
                      ? "Nobody is in this view yet."
                      : "Bring in a list, or wait for people to message you on WhatsApp."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <Table containerClassName="max-h-[65vh] overflow-auto overscroll-contain">
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">
                      <Checkbox
                        aria-label={`Select these ${rows.length}`}
                        title={`Select these ${rows.length}`}
                        checked={allChecked}
                        onCheckedChange={(next) =>
                          pick(next ? new Set([...selected, ...rows.map((row) => row._id)]) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="hidden md:table-cell">Tags</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id} className="cursor-pointer" onClick={() => setPerson(row)}>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${row.name ?? row.phone}`}
                          checked={selected.has(row._id)}
                          onCheckedChange={(next) => {
                            const copy = new Set(selected);
                            if (next) copy.add(row._id);
                            else copy.delete(row._id);
                            pick(copy);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="block rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPerson(row);
                          }}
                        >
                          <span className="block font-medium">{row.name ?? "No name"}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {formatPhone(row.phone)}
                            {row.company ? ` · ${row.company}` : ""}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${categoryTone(categories, row.category)}`}>
                          {categoryLabel(categories, row.category)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {row.tags.slice(0, 4).map((value) => (
                            <Badge key={value} variant="outline" className="text-[10px]">
                              {value}
                            </Badge>
                          ))}
                          {row.tags.length > 4 ? (
                            <span className="text-xs text-muted-foreground">+{row.tags.length - 4}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {row.optedOutAt ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Unsubscribed
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Subscribed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {more ? (
                    <TableRow ref={loadMoreRow} className="hover:bg-transparent">
                      <TableCell colSpan={5} className="py-3">
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Spinner /> Loading more contacts…
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {birthdays}

      {person ? (
        <PersonDialog key={person._id} person={person} categories={categories} onClose={() => setPerson(null)} />
      ) : null}
      <AlertDialog open={deleting} onOpenChange={(next) => !busy && setDeleting(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the list “{view.kind === "audience" ? view.name : ""}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Delete just the list and everyone in it stays a contact, or delete its contacts too.
              Anyone who has messaged you, has an order, record, payment link or form entry, is a
              guest at an event, or is in another list is always kept. Deleted contacts and their
              campaign messages cannot be brought back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="outline" disabled={busy} onClick={() => deleteList(false)}>
              Delete list only
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => deleteList(true)}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete list and contacts
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingMove !== null} onOpenChange={(next) => !next && setPendingMove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {plural(selected.size, "person", "people")} to Incomplete?</AlertDialogTitle>
            <AlertDialogDescription>
              They stay there even after their details are fixed, until you set them to sort
              automatically again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                if (pendingMove !== null) move(pendingMove);
                setPendingMove(null);
              }}
            >
              Move them
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {categoryDialog ? (
        <CategoryDialog
          categories={categories}
          weeklyCap={weeklyCap}
          editing={categoryDialog.editing}
          onClose={() => setCategoryDialog(null)}
          onRemoved={() => choose({ kind: "all" })}
        />
      ) : null}
      {limitOpen ? (
        <WeeklyLimitDialog categories={categories} weeklyCap={weeklyCap} onClose={() => setLimitOpen(false)} />
      ) : null}
    </div>
  );
}

export function AudienceTabSkeleton({
  onAddByHand,
  birthdays,
}: {
  onAddByHand: () => void;
  birthdays: ReactNode;
}) {
  const workspace = useWorkspace();
  return (
    <div className="flex flex-col gap-4">
      <Header>
        <Skeleton className="h-8 w-52 rounded-lg" aria-hidden />
        <ExportContactsButton />
        <Button variant="outline" onClick={onAddByHand}>
          <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} /> Add by hand
        </Button>
        <Skeleton className="h-8 w-56 rounded-lg" aria-hidden />
        <Button nativeButton={false} render={<Link href={`/w/${workspace.slug}/marketing/audience/import`} />}>
          <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} /> Import contacts
        </Button>
      </Header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Can be messaged" />
        <Tile label="Unsubscribed" />
        <Tile label="Lists" />
        <Tile label="Complete contacts" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex gap-2 lg:hidden" aria-hidden>
          <Skeleton className="h-8 flex-1 rounded-lg" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
        <nav className="hidden flex-col gap-3 lg:flex">
          <RailGroup title="Everyone">
            <RailItem active icon={<HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />}>
              All contacts
            </RailItem>
            <RailItem
              active={false}
              icon={<HugeiconsIcon icon={NotificationOff01Icon} strokeWidth={2} />}
              count={<Skeleton className="h-3 w-6" aria-hidden />}
            >
              Unsubscribed
            </RailItem>
          </RailGroup>
          <RailGroup title="Categories">
            <RailSkeleton widths={["w-20", "w-24", "w-16"]} dot />
          </RailGroup>
          <RailGroup title="Lists">
            <RailSkeleton widths={["w-24", "w-32"]} />
          </RailGroup>
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-72">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input disabled placeholder="Search name, number, company" aria-label="Search contacts" className="pl-8" />
            </div>
            <Skeleton className="h-8 w-44 rounded-lg" aria-hidden />
          </div>
          <ContactsSkeleton />
        </div>
      </div>

      {birthdays}
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Audience</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everyone your campaigns and events can reach. Import contacts from a CSV and they are
          cleaned up and checked by Agent Check, then reviewed by you before anyone is added.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ContactsSkeleton() {
  return (
    <div className="overflow-x-auto rounded-md border border-border" aria-hidden>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 pr-0">
              <Skeleton className="size-4 rounded-[4px]" />
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="hidden md:table-cell">Tags</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CONTACT_WIDTHS.map((width, i) => (
            <TableRow key={width}>
              <TableCell className="pr-0">
                <Skeleton className="size-4 rounded-[4px]" />
              </TableCell>
              <TableCell>
                <div className="flex h-5 items-center">
                  <Skeleton className={`h-3.5 ${width}`} />
                </div>
                <Skeleton className={`my-0.5 h-3 ${i % 3 === 1 ? "w-44" : "w-28"}`} />
              </TableCell>
              <TableCell>
                <Skeleton className={`h-5 rounded ${i % 2 ? "w-20" : "w-16"}`} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex gap-1">
                  {i % 3 !== 2 ? <Skeleton className="h-5 w-14 rounded-full" /> : null}
                  {i % 3 === 0 ? <Skeleton className="h-5 w-10 rounded-full" /> : null}
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RailSkeleton({ widths, dot }: { widths: string[]; dot?: boolean }) {
  return (
    <>
      {widths.map((width) => (
        <div key={width} className="flex items-center gap-2 px-2 py-1.5" aria-hidden>
          <span className="flex size-4 items-center justify-center">
            <Skeleton className={dot ? "size-2.5 rounded-full" : "size-4 rounded"} />
          </span>
          <div className="flex h-5 min-w-0 flex-1 items-center">
            <Skeleton className={`h-3.5 ${width}`} />
          </div>
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </>
  );
}

function Tile({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="my-1 h-6 w-16" aria-hidden />
      ) : (
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}

function RailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function RailItem({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  icon: ReactNode;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors [&_svg]:size-4 ${
        active ? "bg-muted font-medium" : "hover:bg-muted/50"
      }`}
    >
      <span className="flex size-4 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

function BulkBar({
  count,
  busy,
  categories,
  audiences,
  inList,
  onCategory,
  onTag,
  onNewList,
  onAddToList,
  onRemoveFromList,
  onClear,
}: {
  count: number;
  busy: boolean;
  categories: Category[];
  audiences: Array<{ value: string; label: string }>;
  inList: boolean;
  onCategory: (category: string) => void;
  onTag: (tag: string) => void;
  onNewList: (name: string) => void;
  onAddToList: (audienceId: Id<"audiences">) => void;
  onRemoveFromList?: () => void;
  onClear: () => void;
}) {
  const [tag, setTag] = useState("");
  const [listName, setListName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
      <span className="flex items-center gap-1.5 px-1 font-medium">
        {busy ? <Spinner /> : null}
        {plural(count, "selected", "selected")}
      </span>
      <SelectField
        size="sm"
        aria-label="Move to category"
        className="w-40"
        value=""
        placeholder="Move to…"
        disabled={busy}
        onValueChange={(value) => onCategory(value === AUTO ? "" : value)}
        options={[
          ...categories.map((c) => ({ value: c.key, label: c.label })),
          { value: AUTO, label: "Sort automatically" },
        ]}
      />
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !tag.trim()) return;
          onTag(tag.trim());
          setTag("");
        }}
      >
        <Input value={tag} placeholder="Add a tag" className="h-7 w-32" onChange={(e) => setTag(e.target.value)} />
        <Button size="sm" type="submit" variant="outline" disabled={busy || !tag.trim()}>
          <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} /> Tag
        </Button>
      </form>
      {audiences.length > 0 && !inList ? (
        <SelectField
          size="sm"
          aria-label="Add to list"
          className="w-40"
          value=""
          placeholder="Add to list…"
          disabled={busy}
          onValueChange={(value) => onAddToList(value as Id<"audiences">)}
          options={audiences}
        />
      ) : null}
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !listName.trim()) return;
          onNewList(listName.trim());
          setListName("");
        }}
      >
        <Input
          value={listName}
          placeholder="New list name"
          className="h-7 w-36"
          onChange={(e) => setListName(e.target.value)}
        />
        <Button size="sm" type="submit" variant="outline" disabled={busy || !listName.trim()}>
          <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} /> Save as list
        </Button>
      </form>
      {onRemoveFromList ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemoveFromList}>
          Remove from list
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
