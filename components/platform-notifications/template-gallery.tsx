"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIES, CHANNELS, type Category } from "./shared";
import { TEMPLATES, type NotificationTemplate } from "./templates";

export function TemplateGallery({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: NotificationTemplate) => void;
}) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const shown = filter === "all" ? TEMPLATES : TEMPLATES.filter((item) => item.category === filter);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Fills the title, message, email and SMS. Replace every [placeholder] before sending.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={filter} onValueChange={(value) => setFilter(value as Category | "all")}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {CATEGORIES.map((category) => (
              <TabsTrigger key={category.value} value={category.value}>
                {category.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="-mx-1 grid min-h-0 flex-1 gap-3 overflow-y-auto px-1 py-1 sm:grid-cols-2">
          {shown.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onPick(template)}
              className="flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                </div>
                <div className="flex shrink-0 gap-1 text-muted-foreground">
                  {CHANNELS.filter((channel) => template.channels[channel.value]).map((channel) => (
                    <channel.icon key={channel.value} className="size-3.5" aria-label={channel.label} />
                  ))}
                </div>
              </div>
              <div className="rounded-md bg-muted/60 p-2">
                <p className="truncate text-xs font-semibold">{template.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{template.body}</p>
              </div>
              <Badge variant="outline" className="w-fit">
                {CATEGORIES.find((category) => category.value === template.category)?.label}
              </Badge>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Start blank
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
