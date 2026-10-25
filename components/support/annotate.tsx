"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  BlurIcon,
  SquareIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";

type Tool = "arrow" | "box" | "blur";
type Shape = { tool: Tool; x1: number; y1: number; x2: number; y2: number };

const INK = "#ef4444";

function pixelate(ctx: CanvasRenderingContext2D, image: HTMLImageElement, shape: Shape) {
  const x = Math.min(shape.x1, shape.x2);
  const y = Math.min(shape.y1, shape.y2);
  const w = Math.abs(shape.x2 - shape.x1);
  const h = Math.abs(shape.y2 - shape.y1);
  if (w < 2 || h < 2) return;
  const block = Math.max(8, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 120));
  const tiny = document.createElement("canvas");
  tiny.width = Math.max(1, Math.ceil(w / block));
  tiny.height = Math.max(1, Math.ceil(h / block));
  tiny.getContext("2d")!.drawImage(image, x, y, w, h, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function arrow(ctx: CanvasRenderingContext2D, shape: Shape, width: number) {
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const head = width * 5;
  ctx.beginPath();
  ctx.moveTo(shape.x1, shape.y1);
  ctx.lineTo(shape.x2, shape.y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shape.x2, shape.y2);
  ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 7), shape.y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 7), shape.y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, shapes: Shape[]) {
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  for (const shape of shapes) if (shape.tool === "blur") pixelate(ctx, image, shape);
  const width = Math.max(3, Math.round(image.naturalWidth / 320));
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = "round";
  for (const shape of shapes) {
    if (shape.tool === "box") {
      ctx.strokeRect(
        Math.min(shape.x1, shape.x2),
        Math.min(shape.y1, shape.y2),
        Math.abs(shape.x2 - shape.x1),
        Math.abs(shape.y2 - shape.y1)
      );
    }
    if (shape.tool === "arrow") arrow(ctx, shape, width);
  }
}

/** Arrows, boxes and blur on a screenshot, so a client can point at the problem and hide what is private. */
export function AnnotateDialog({
  file,
  onClose,
  onSave,
}: {
  file: File | null;
  onClose: () => void;
  onSave: (file: File) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [loadedFor, setLoadedFor] = useState<File | null>(null);

  if (loadedFor !== file) {
    setLoadedFor(file);
    setImage(null);
    setShapes([]);
    setDraft(null);
  }

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    if (canvas.width !== image.naturalWidth) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }
    paint(canvas, image, draft ? [...shapes, draft] : shapes);
  }, [image, shapes, draft]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !file) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const name = file.name.replace(/\.[^.]+$/, "") + ".png";
      onSave(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  };

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Mark up the screenshot</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={[tool]}
            onValueChange={(value) => {
              const next = value[0] as Tool | undefined;
              if (next) setTool(next);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="box" aria-label="Box">
              <HugeiconsIcon icon={SquareIcon} strokeWidth={2} /> Box
            </ToggleGroupItem>
            <ToggleGroupItem value="arrow" aria-label="Arrow">
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} /> Arrow
            </ToggleGroupItem>
            <ToggleGroupItem value="blur" aria-label="Blur">
              <HugeiconsIcon icon={BlurIcon} strokeWidth={2} /> Hide
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="ghost"
            size="sm"
            disabled={shapes.length === 0}
            onClick={() => setShapes((list) => list.slice(0, -1))}
          >
            <HugeiconsIcon icon={Undo02Icon} strokeWidth={2} /> Undo
          </Button>
          <p className="text-xs text-muted-foreground">
            Drag on the image. Use Hide on anything private before you send.
          </p>
        </div>
        <div className="max-h-[65vh] overflow-auto rounded-lg border bg-muted/40">
          <canvas
            ref={canvasRef}
            className="block h-auto w-full cursor-crosshair touch-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const { x, y } = point(event);
              setDraft({ tool, x1: x, y1: y, x2: x, y2: y });
            }}
            onPointerMove={(event) => {
              if (!draft) return;
              const { x, y } = point(event);
              setDraft({ ...draft, x2: x, y2: y });
            }}
            onPointerUp={() => {
              if (draft && (Math.abs(draft.x2 - draft.x1) > 4 || Math.abs(draft.y2 - draft.y1) > 4)) {
                setShapes((list) => [...list, draft]);
              }
              setDraft(null);
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!image}>
            Use this image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
