"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { putFile, type UploadTarget } from "@/lib/upload";
import {
  FileIcon,
  FilePdfIcon,
  PaperclipIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";

export const MAX_PRODUCT_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

export type FileDraft = {
  fileKey?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  url?: string;
  file?: File;
};

export type StoredProductFile = {
  fileKey: string;
  filename: string;
  mimeType?: string;
  size?: number;
};

export function filesFromProduct(
  files: StoredProductFile[],
  resolved: Array<{ url: string }>
): FileDraft[] {
  return files.map((file, index) => ({ ...file, url: resolved[index]?.url }));
}

export async function uploadFileDrafts(
  drafts: FileDraft[],
  getUploadUrl: () => Promise<UploadTarget>
): Promise<StoredProductFile[]> {
  const out: StoredProductFile[] = [];
  for (const draft of drafts) {
    if (draft.fileKey) {
      out.push({
        fileKey: draft.fileKey,
        filename: draft.filename,
        mimeType: draft.mimeType,
        size: draft.size,
      });
      continue;
    }
    if (!draft.file) continue;
    const fileKey = await putFile(await getUploadUrl(), draft.file).catch(
      (error: Error) => {
        throw new Error(`Could not upload ${draft.filename}: ${error.message}`);
      }
    );
    out.push({
      fileKey,
      filename: draft.filename,
      mimeType: draft.file.type || undefined,
      size: draft.file.size,
    });
  }
  return out;
}

export function formatBytes(size: number | null | undefined) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileGlyph({
  filename,
  className,
}: {
  filename: string;
  className?: string;
}) {
  return filename.toLowerCase().endsWith(".pdf") ? (
    <FilePdfIcon className={className ?? "size-4 shrink-0 text-red-600"} />
  ) : (
    <FileIcon className={className ?? "size-4 shrink-0 text-muted-foreground"} />
  );
}

export function ProductFilesEditor({
  value,
  onChange,
  description,
}: {
  value: FileDraft[];
  onChange: (next: FileDraft[]) => void;
  description?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  const add = (picked: FileList | null) => {
    const chosen = Array.from(picked ?? []);
    const tooBig = chosen.filter((file) => file.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      toast.add({
        title: `${tooBig.map((file) => file.name).join(", ")} is over 25 MB`,
        type: "error",
      });
    }
    const fresh = chosen
      .filter((file) => file.size <= MAX_FILE_BYTES)
      .map((file) => ({
        filename: file.name,
        mimeType: file.type || undefined,
        size: file.size,
        file,
      }));
    const next = [...value, ...fresh];
    if (next.length > MAX_PRODUCT_FILES) {
      toast.add({
        title: `At most ${MAX_PRODUCT_FILES} files`,
        type: "error",
      });
    }
    onChange(next.slice(0, MAX_PRODUCT_FILES));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label>
            <PaperclipIcon /> Files
          </Label>
          <p className="text-xs text-muted-foreground">
            {description ??
              "PDFs and documents agents can send to customers — up to 25 MB each."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= MAX_PRODUCT_FILES}
          onClick={() => input.current?.click()}
        >
          <UploadSimpleIcon /> Add file
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {value.map((draft, index) => (
            <li
              key={draft.fileKey ?? `${draft.filename}-${index}`}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <FileGlyph filename={draft.filename} />
              {draft.url ? (
                <a
                  href={draft.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {draft.filename}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate">{draft.filename}</span>
              )}
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.file ? "Not uploaded yet · " : ""}
                {formatBytes(draft.size)}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${draft.filename}`}
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
