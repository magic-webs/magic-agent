"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { downloadCsv, parseCsv, toCsv } from "@/lib/csv";
import { contactsToCsv } from "@/lib/contact-csv";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, FileExportIcon } from "@hugeicons/core-free-icons";

/** How many contacts one export call reads. */
const PAGE = 500;

type ExportPage = FunctionReturnType<typeof api.contacts.exportPage>;

type Filter = {
  audienceId?: Id<"audiences">;
  category?: string;
  subscription?: "subscribed" | "unsubscribed";
};

type Target = { label: string; count?: string; filter: Filter };

function fileSlug(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "contacts"
  );
}

/**
 * Downloads WhatsApp contacts as the same CSV the importer reads, so a list
 * can be taken out, tidied in a spreadsheet and brought back.
 *
 * Read a page at a time on the click rather than kept subscribed: the table
 * on screen shows at most a few hundred, and an export is a one-off.
 */
export function ExportContactsButton({
  reachable,
  optedOut,
  categories = [],
  lists = [],
}: {
  reachable?: string;
  optedOut?: string;
  categories?: Array<{ key: string; label: string; count?: string }>;
  lists?: Array<{ id: Id<"audiences">; name: string; count: string }>;
}) {
  const workspace = useWorkspace();
  const convex = useConvex();
  const [busy, setBusy] = useState(false);

  const run = async (target: Target) => {
    setBusy(true);
    try {
      const contacts: ExportPage["page"] = [];
      let cursor: string | null = null;
      for (;;) {
        const result: ExportPage = await convex.query(api.contacts.exportPage, {
          workspaceId: workspace._id,
          paginationOpts: { numItems: PAGE, cursor },
          ...target.filter,
        });
        contacts.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      if (contacts.length === 0) {
        toast.add({ title: "Nothing to export", description: `${target.label} has no WhatsApp contacts.` });
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      const [header, ...lines] = parseCsv(contactsToCsv(contacts));
      const table = [
        [...header, "unsubscribed"],
        ...lines.map((line, index) => {
          const optedOutAt = contacts[index].optedOutAt;
          return [...line, optedOutAt ? new Date(optedOutAt).toISOString().slice(0, 10) : ""];
        }),
      ];
      downloadCsv(`${workspace.slug}-${fileSlug(target.label)}-${day}.csv`, toCsv(table));
      toast.add({
        title: `${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"} exported`,
        description: target.label,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not export the contacts",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const item = (target: Target, key: string) => (
    <DropdownMenuItem key={key} onClick={() => void run(target)}>
      <span className="min-w-0 flex-1 truncate">{target.label}</span>
      {target.count !== undefined ? (
        <span className="text-xs text-muted-foreground tabular-nums">{target.count}</span>
      ) : null}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={busy} render={<Button variant="outline" />}>
        {busy ? <Spinner /> : <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />} Export
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Everyone</DropdownMenuLabel>
          {item({ label: "All contacts", filter: {} }, "all")}
          {item({ label: "Can be messaged", count: reachable, filter: { subscription: "subscribed" } }, "subscribed")}
          {item({ label: "Unsubscribed", count: optedOut, filter: { subscription: "unsubscribed" } }, "unsubscribed")}
        </DropdownMenuGroup>
        {categories.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Categories</DropdownMenuLabel>
              {categories.map((category) =>
                item(
                  { label: category.label, count: category.count, filter: { category: category.key } },
                  `category:${category.key}`
                )
              )}
            </DropdownMenuGroup>
          </>
        ) : null}
        {lists.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Lists</DropdownMenuLabel>
              {lists.map((list) =>
                item({ label: list.name, count: list.count, filter: { audienceId: list.id } }, `list:${list.id}`)
              )}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
