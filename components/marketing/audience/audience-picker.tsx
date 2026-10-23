"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SEGMENTS } from "@/convex/lib/segments";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { plural, type Category } from "./shared";

export type AudienceChoice = {
  audienceIds: Id<"audiences">[];
  categories: string[];
  tags: string[];
  excludeAudienceIds: Id<"audiences">[];
  segments?: string[];
  records?: RecordChoice[];
};

export type RecordChoice = { bookId: Id<"recordBooks">; stages?: string[] };

export const EVERYONE: AudienceChoice = {
  audienceIds: [],
  categories: [],
  tags: [],
  excludeAudienceIds: [],
};

export function isEveryone(choice: AudienceChoice) {
  return (
    choice.audienceIds.length === 0 &&
    choice.categories.length === 0 &&
    choice.tags.length === 0 &&
    !choice.records?.length
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Chip({
  active,
  excluded,
  onClick,
  children,
  count,
}: {
  active: boolean;
  excluded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        excluded
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : active
            ? "border-primary bg-primary/10 text-primary"
            : "border-border hover:bg-muted/50"
      )}
    >
      {excluded ? <HugeiconsIcon icon={MinusSignCircleIcon} strokeWidth={2} className="size-3.5" /> : active ? <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" /> : null}
      {children}
      {count !== undefined ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </button>
  );
}

export function AudiencePicker({
  value,
  onChange,
  categories,
  onValidChange,
}: {
  value: AudienceChoice;
  onChange: (next: AudienceChoice) => void;
  categories: Category[];
  onValidChange?: (valid: boolean) => void;
}) {
  const workspace = useWorkspace();
  const audiences = useQuery(api.audience.list, { workspaceId: workspace._id });
  const summary = useQuery(api.audience.tags, { workspaceId: workspace._id });
  const books = useQuery(api.records.listBooks, { workspaceId: workspace._id });
  const [mode, setMode] = useState<"everyone" | "some">(isEveryone(value) ? "everyone" : "some");
  const everyone = mode === "everyone";
  const nobody = !everyone && isEveryone(value);

  const change = (next: AudienceChoice, nextMode = mode) => {
    onChange(next);
    onValidChange?.(nextMode === "everyone" || !isEveryone(next));
  };

  const records = value.records ?? [];
  const setRecords = (next: RecordChoice[]) =>
    change({ ...value, records: next.length ? next : undefined });
  const toggleBook = (bookId: Id<"recordBooks">) =>
    setRecords(
      records.some((choice) => choice.bookId === bookId)
        ? records.filter((choice) => choice.bookId !== bookId)
        : [...records, { bookId }]
    );
  const toggleStage = (bookId: Id<"recordBooks">, stage: string) =>
    setRecords(
      records.map((choice) => {
        if (choice.bookId !== bookId) return choice;
        const stages = toggle(choice.stages ?? [], stage);
        return stages.length ? { bookId, stages } : { bookId };
      })
    );

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        variant="outline"
        value={[mode]}
        onValueChange={(next) => {
          if (next[0] === "everyone") {
            setMode("everyone");
            change(
              { ...EVERYONE, excludeAudienceIds: value.excludeAudienceIds, segments: value.segments },
              "everyone"
            );
          }
          if (next[0] === "some" && everyone) {
            setMode("some");
            change(categories[0] ? { ...value, categories: [categories[0].key] } : value, "some");
          }
        }}
      >
        <ToggleGroupItem value="everyone">Everyone subscribed</ToggleGroupItem>
        <ToggleGroupItem value="some">Choose who</ToggleGroupItem>
      </ToggleGroup>

      {!everyone ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Categories</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => (
                <Chip
                  key={category.key}
                  active={value.categories.includes(category.key)}
                  count={summary?.categories[category.key]}
                  onClick={() => change({ ...value, categories: toggle(value.categories, category.key) })}
                >
                  {category.label}
                </Chip>
              ))}
            </div>
          </div>
          {audiences && audiences.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Lists</p>
              <div className="flex flex-wrap gap-1.5">
                {audiences.map((audience) => (
                  <Chip
                    key={audience._id}
                    active={value.audienceIds.includes(audience._id)}
                    count={audience.memberCount}
                    onClick={() =>
                      change({
                        ...value,
                        audienceIds: toggle(value.audienceIds, audience._id),
                        excludeAudienceIds: value.excludeAudienceIds.filter((id) => id !== audience._id),
                      })
                    }
                  >
                    {audience.name}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {summary && summary.tags.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {summary.tags.slice(0, 30).map((row) => (
                  <Chip
                    key={row.tag}
                    active={value.tags.includes(row.tag)}
                    count={row.count}
                    onClick={() => change({ ...value, tags: toggle(value.tags, row.tag) })}
                  >
                    {row.tag}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {books && books.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Record books</p>
              <div className="flex flex-wrap gap-1.5">
                {books.map((book) => (
                  <Chip
                    key={book._id}
                    active={records.some((choice) => choice.bookId === book._id)}
                    count={book.recordCount}
                    onClick={() => toggleBook(book._id)}
                  >
                    {book.pluralName}
                  </Chip>
                ))}
              </div>
              {records.map((choice) => {
                const book = books.find((row) => row._id === choice.bookId);
                if (!book || book.stages.length === 0) return null;
                return (
                  <div key={choice.bookId} className="flex flex-wrap items-center gap-1.5 pl-2">
                    <span className="text-xs text-muted-foreground">
                      {book.pluralName} at
                    </span>
                    {book.stages.map((stage) => (
                      <Chip
                        key={stage}
                        active={(choice.stages ?? []).includes(stage)}
                        onClick={() => toggleStage(book._id, stage)}
                      >
                        {stage}
                      </Chip>
                    ))}
                    {!choice.stages?.length ? (
                      <span className="text-xs text-muted-foreground">any stage</span>
                    ) : null}
                  </div>
                );
              })}
              {records.length ? (
                <p className="text-xs text-muted-foreground">
                  The people those records are about, matched by their contact or
                  phone number.
                </p>
              ) : null}
            </div>
          ) : null}
          {nobody ? (
            <p className="text-xs text-destructive">
              Pick at least one category, list, tag or record book, or switch to everyone subscribed.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Anyone matching at least one choice is included.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Only people who…</p>
        <div className="flex flex-wrap gap-1.5">
          {SEGMENTS.map((segment) => (
            <Chip
              key={segment.key}
              active={(value.segments ?? []).includes(segment.key)}
              onClick={() => {
                const segments = toggle(value.segments ?? [], segment.key);
                change({ ...value, segments: segments.length > 0 ? segments : undefined });
              }}
            >
              {segment.label}
            </Chip>
          ))}
        </div>
        {(value.segments ?? []).length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Narrows the people above to those who match every one of these.
          </p>
        ) : null}
      </div>

      {audiences && audiences.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Leave out anyone on</p>
          <div className="flex flex-wrap gap-1.5">
            {audiences
              .filter((audience) => !value.audienceIds.includes(audience._id))
              .map((audience) => (
                <Chip
                  key={audience._id}
                  active={false}
                  excluded={value.excludeAudienceIds.includes(audience._id)}
                  onClick={() =>
                    change({
                      ...value,
                      excludeAudienceIds: toggle(value.excludeAudienceIds, audience._id),
                    })
                  }
                >
                  {audience.name}
                </Chip>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AudienceCount({ value }: { value: AudienceChoice }) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const size = useQuery(api.audience.size, { workspaceId: workspace._id, audience: value, now });
  if (!size) return <Spinner />;
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Badge>
        {size.partial ? "About " : ""}
        {plural(size.reachable, "person", "people")}
      </Badge>
      {size.optedOut ? (
        <span className="text-xs text-muted-foreground">{size.optedOut} unsubscribed left out</span>
      ) : null}
      {size.overCap ? (
        <span className="text-xs text-muted-foreground">{size.overCap} over the weekly limit</span>
      ) : null}
    </span>
  );
}
