export const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";
export const SECTION = "py-[clamp(5rem,11vw,9rem)]";
export const PILL =
  "group inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium transition duration-300 hover:-translate-y-0.5";

export function Eyebrow({ index, children }: { index?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs tracking-[0.12em] text-(--ink-muted) uppercase">
      {index && <span className="font-mono tracking-normal">{index}</span>}
      <span>{children}</span>
      <span className="h-px flex-1 bg-(--line)" />
    </div>
  );
}
