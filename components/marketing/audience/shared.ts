import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";

export type Category = { key: string; label: string; description: string };

export function formatPhone(digits: string): string {
  if (/^91\d{10}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

export function categoryLabel(categories: Category[], key: string | null | undefined): string {
  if (!key) return "Not sorted";
  return categories.find((category) => category.key === key)?.label ?? "Sorted automatically";
}

const TONES = [
  { tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  { tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  { tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  { tone: "bg-teal-500/10 text-teal-700 dark:text-teal-300", dot: "bg-teal-500" },
];

function toneOf(categories: Category[], key: string | null | undefined) {
  if (key === "valid") return { tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" };
  if (key === "invalid") return { tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" };
  const custom = categories.filter((category) => category.key !== "valid" && category.key !== "invalid");
  const index = custom.findIndex((category) => category.key === key);
  if (index < 0) return { tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  return TONES[index % TONES.length];
}

export function categoryTone(categories: Category[], key: string | null | undefined): string {
  return toneOf(categories, key).tone;
}

export function categoryDot(categories: Category[], key: string | null | undefined): string {
  return toneOf(categories, key).dot;
}

export function fail(title: string, error: unknown) {
  toast.add({ title, description: friendlyError(error), type: "error" });
}

export function countText(count: number, capped: boolean | undefined) {
  return `${count.toLocaleString()}${capped ? "+" : ""}`;
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
