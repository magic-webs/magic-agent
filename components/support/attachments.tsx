"use client";

import { useCallback, useRef, useState } from "react";
import { SUPPORT_LIMITS } from "@/convex/lib/support";
import { putFile, type UploadTarget } from "@/lib/upload";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { AnnotateDialog } from "@/components/support/annotate";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Attachment01Icon,
  Cancel01Icon,
  ComputerScreenShareIcon,
  File01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";

export type SupportFile = { key: string; name: string; type: string; size: number };

type Draft = {
  id: string;
  file: File;
  preview: string | null;
  status: "uploading" | "done" | "failed";
  key?: string;
};

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function captureScreen(): Promise<File | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob
      ? new File([blob], `screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`, {
          type: "image/png",
        })
      : null;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

export function useSupportFiles(uploadUrl: () => Promise<UploadTarget>) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [annotating, setAnnotating] = useState<{ id: string | null; file: File } | null>(null);

  const upload = useCallback(
    async (draft: Draft) => {
      try {
        const key = await putFile(await uploadUrl(), draft.file);
        setDrafts((list) =>
          list.map((item) => (item.id === draft.id ? { ...item, status: "done", key } : item))
        );
      } catch (error) {
        setDrafts((list) =>
          list.map((item) => (item.id === draft.id ? { ...item, status: "failed" } : item))
        );
        toast.add({ title: `${draft.file.name} did not upload`, description: friendlyError(error), type: "error" });
      }
    },
    [uploadUrl]
  );

  const add = useCallback(
    (files: File[], replaceId?: string) => {
      const base = replaceId ? drafts.filter((item) => item.id !== replaceId) : drafts;
      const room = SUPPORT_LIMITS.files - base.length;
      const accepted: Draft[] = [];
      for (const file of files) {
        if (file.size > SUPPORT_LIMITS.fileBytes) {
          toast.add({ title: `${file.name} is over 20 MB`, type: "error" });
          continue;
        }
        if (accepted.length >= room) {
          toast.add({ title: `Attach up to ${SUPPORT_LIMITS.files} files`, type: "error" });
          break;
        }
        accepted.push({
          id: crypto.randomUUID(),
          file,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          status: "uploading",
        });
      }
      setDrafts([...base, ...accepted]);
      for (const draft of accepted) void upload(draft);
    },
    [drafts, upload]
  );

  const remove = useCallback((id: string) => {
    setDrafts((list) => list.filter((item) => item.id !== id));
  }, []);

  const capture = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.add({ title: "This browser cannot capture the screen", type: "error" });
      return;
    }
    try {
      const file = await captureScreen();
      if (file) setAnnotating({ id: null, file });
    } catch {
      // Cancelled at the browser's picker.
    }
  }, []);

  const clear = useCallback(() => setDrafts([]), []);

  const surface = {
    onPaste: (event: React.ClipboardEvent) => {
      const files = [...event.clipboardData.files];
      if (files.length === 0) return;
      event.preventDefault();
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 1 && files.length === 1) {
        const image = images[0]!;
        setAnnotating({
          id: null,
          file: new File([image], `pasted-${Date.now()}.png`, { type: image.type }),
        });
      } else {
        add(files);
      }
    },
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    },
    onDrop: (event: React.DragEvent) => {
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      add([...event.dataTransfer.files]);
    },
  };

  return {
    drafts,
    add,
    remove,
    capture,
    clear,
    surface,
    annotating,
    setAnnotating,
    busy: drafts.some((draft) => draft.status === "uploading"),
    files: drafts.flatMap((draft): SupportFile[] =>
      draft.status === "done" && draft.key
        ? [{ key: draft.key, name: draft.file.name, type: draft.file.type || "application/octet-stream", size: draft.file.size }]
        : []
    ),
  };
}

export type SupportFiles = ReturnType<typeof useSupportFiles>;

export function AttachmentBar({
  files,
  className,
  compact = false,
}: {
  files: SupportFiles;
  className?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,application/pdf,.txt,.log,.csv,.json,.zip,.doc,.docx,.xls,.xlsx"
          onChange={(event) => {
            files.add([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} onClick={() => input.current?.click()}>
          <HugeiconsIcon icon={Attachment01Icon} strokeWidth={2} /> {compact ? "Attach" : "Add files"}
        </Button>
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} onClick={() => void files.capture()}>
          <HugeiconsIcon icon={ComputerScreenShareIcon} strokeWidth={2} /> {compact ? "Screenshot" : "Capture screen"}
        </Button>
        {!compact ? (
          <span className="text-sm text-muted-foreground">
            {files.drafts.length} file(s) · paste or drop screenshots here
          </span>
        ) : null}
      </div>

      {files.drafts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.drafts.map((draft) => (
            <div
              key={draft.id}
              className={cn(
                "group relative flex h-20 w-28 items-center justify-center overflow-hidden rounded-lg border bg-muted/40",
                draft.status === "failed" && "border-destructive"
              )}
              title={`${draft.file.name} · ${sizeLabel(draft.file.size)}`}
            >
              {draft.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.preview} alt={draft.file.name} className="size-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 px-2 text-center">
                  <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-5 text-muted-foreground" />
                  <span className="line-clamp-2 text-[11px] leading-tight">{draft.file.name}</span>
                </div>
              )}
              {draft.status === "uploading" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Spinner />
                </div>
              ) : null}
              <div className="absolute top-1 right-1 flex gap-1">
                {draft.preview && draft.status !== "uploading" ? (
                  <button
                    type="button"
                    aria-label="Mark up"
                    className="rounded-md bg-background/90 p-1 shadow-sm"
                    onClick={() => files.setAnnotating({ id: draft.id, file: draft.file })}
                  >
                    <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove"
                  className="rounded-md bg-background/90 p-1 shadow-sm"
                  onClick={() => files.remove(draft.id)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <AnnotateDialog
        file={files.annotating?.file ?? null}
        onClose={() => files.setAnnotating(null)}
        onSave={(file) => {
          const id = files.annotating?.id ?? undefined;
          files.setAnnotating(null);
          files.add([file], id);
        }}
      />
    </div>
  );
}

export function AttachmentList({
  attachments,
}: {
  attachments: { key: string; name: string; type: string; size: number; url: string }[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((file) =>
        file.type.startsWith("image/") ? (
          <a
            key={file.key}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="block h-24 w-36 overflow-hidden rounded-lg border bg-muted/40"
            title={file.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.url} alt={file.name} className="size-full object-cover" />
          </a>
        ) : (
          <a
            key={file.key}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-60 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted"
          >
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(file.size)}</span>
          </a>
        )
      )}
    </div>
  );
}
