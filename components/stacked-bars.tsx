"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "motion/react";

/* ══ Stacked bars ═════════════════════════════════════════
   An alert-volume card: a stack of four sources for every day (or
   week), and under the baseline the few that were escalated.

   ── RUN ALONG IT ────────────────────────────────────────
   The column under the pointer gets a ring round its whole stack,
   the rest step back (their colour mixed toward the slab, never
   faded), and one tooltip glides beside it on a spring with the
   date, the total and what made it up.

   ── DAY / WEEK ──────────────────────────────────────────
   Swaps the dataset; every segment eases to its new height and
   offset a beat after its left neighbour. The same transition
   grows the bars out of the baseline the first time the card is
   seen.

   ── REAL DATA ───────────────────────────────────────────
   Pass `days` (and `weeks`, for the Day / Week control) to chart
   your own series; leave them off for Bencho's seeded demo. With
   `fluid` the card fills its column and the plot is measured. */

const W = 300;
const PAD = 16;
const CH = 104; // room above the baseline
const BH = 22; // room below it for the escalated bars
const SEG_GAP = 2;
const LIFT = 2; // air between the baseline and the bars either side of it
const TIP_W = 132;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

const CATS = ["Direct", "Search", "Social", "Email"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LAST = Date.UTC(2026, 9, 11); // the last day shown, Oct 11
const DAY_MS = 86400000;

type Mode = "Day" | "Week";
export type StackedBar = { vals: number[]; esc: number; label: string; short: string };
type Bar = StackedBar;
/* `tone` picks one of the six palette steps, so a series keeps its
   colour whichever others are present */
export type StackedCategory = { label: string; tone?: number };

/* a small seeded generator: the same chart on every load */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmtDay = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function makeBars(mode: Mode, n: number): Bar[] {
  const rnd = mulberry(mode === "Day" ? 4396 : 9117);
  const base = [520, 360, 210, 260];
  const out: Bar[] = [];
  for (let i = 0; i < 30; i++) {
    const back = 29 - i; // only the last n are kept, so the data does not reshuffle with the count
    if (mode === "Day") {
      const ms = LAST - back * DAY_MS;
      const wd = new Date(ms).getUTCDay();
      const quiet = wd === 0 || wd === 6 ? 0.55 : 1;
      const surge = rnd() < 0.12 ? 1.5 : 1;
      const vals = base.map((b, k) => Math.round(b * quiet * (0.6 + rnd() * 0.8) * (k === 3 ? surge * surge : surge)));
      const esc = Math.round(3 + rnd() * 9 * quiet * surge);
      out.push({ vals, esc, label: fmtDay(ms), short: fmtDay(ms) });
    } else {
      const end = LAST - back * 7 * DAY_MS;
      const start = end - 6 * DAY_MS;
      const vals = base.map((b) => Math.round(b * 5.6 * (0.75 + rnd() * 0.5)));
      const esc = Math.round(30 + rnd() * 44);
      const s = new Date(start), e = new Date(end);
      const label = s.getUTCMonth() === e.getUTCMonth()
        ? `${fmtDay(start)} – ${e.getUTCDate()}`
        : `${fmtDay(start)} – ${fmtDay(end)}`;
      out.push({ vals, esc, label, short: fmtDay(start) });
    }
  }
  return out.slice(30 - n);
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function StackedBars({
  colour = "Colour",
  bars = 20,
  gap = 6,
  days,
  weeks,
  categories = CATS.map((label) => ({ label })),
  title = "Traffic",
  unit = "visits",
  escLabel = "Bounced",
  height = CH,
  fluid = false,
  legend = false,
  className,
}: {
  colour?: "Mono" | "Colour";
  bars?: number;
  gap?: number;
  days?: StackedBar[];
  weeks?: StackedBar[];
  categories?: StackedCategory[];
  title?: string;
  unit?: string;
  escLabel?: string;
  height?: number;
  fluid?: boolean;
  /* each category with its total, under the axis */
  legend?: boolean;
  className?: string;
}) {
  const demo = !days;
  /* Week first (2026-11-19): the steadier, fuller view to open on */
  const [mode, setMode] = useState<Mode>(demo || weeks ? "Week" : "Day");
  const toggle = demo || !!weeks;
  const [at, setAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const plot = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(W);

  useEffect(() => {
    const el = root.current;
    if (!fluid || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setMeasured(e.contentRect.width + PAD * 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fluid]);
  const CW = (fluid ? measured : W) - PAD * 2; // the plot's width

  /* grow in once, the first time the card is on screen */
  useEffect(() => {
    const el = root.current;
    if (!el || seen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const demoBars = useMemo(() => (demo ? makeBars(mode, Math.max(2, Math.round(bars))) : []), [demo, mode, bars]);
  const data = demo ? demoBars : mode === "Week" && weeks ? weeks : days;
  const n = data.length;

  /* geometry: the gap gives way before a bar gets thinner than 3px,
     so 30 bars at the widest gap still draw */
  const g = n > 1 ? Math.max(1, Math.min(gap, (CW - 3 * n) / (n - 1))) : 0;
  const bw = (CW - g * (n - 1)) / n;
  const r = Math.min(2.5, bw / 2);
  const totals = data.map((b) => sum(b.vals));
  /* floors of 1 so an empty window draws a flat baseline rather
     than dividing by zero */
  const maxT = Math.max(1, ...totals);
  const maxE = Math.max(1, ...data.map((b) => b.esc));
  const scale = (height - LIFT - 2 - SEG_GAP * (categories.length - 1)) / maxT;
  const layout = data.map((b) => {
    let y = 0;
    /* a zero is no segment and no gap: real series are mostly zeros
       for the quieter categories, and 2px stubs would read as data */
    const segs = b.vals.map((v) => {
      const h = v > 0 ? Math.max(2, v * scale) : 0;
      const s = { bottom: y, h };
      if (h) y += h + SEG_GAP;
      return s;
    });
    return {
      segs,
      top: Math.max(0, y - SEG_GAP),
      esc: b.esc > 0 ? Math.max(3, (b.esc / maxE) * (BH - LIFT - 2)) : 0,
    };
  });
  const tone = (k: number) => `var(--stb-c${categories[k]?.tone ?? k + 1})`;

  /* the headline pops in on a change, Price flow's way: every
     character is keyed by a generation, so a new total is new
     elements and each plays one short entrance, left to right.
     The first paint does not play it; only a change does. */
  const total = sum(totals);
  const [gen, setGen] = useState(0);
  const last = useRef(total);
  useEffect(() => {
    if (last.current === total) return;
    last.current = total;
    setGen((g) => g + 1);
  }, [total]);

  /* ring and tooltip: placed at once when they appear, glide after */
  const ringX = useMotionValue(0);
  const ringY = useMotionValue(0);
  const ringH = useMotionValue(0);
  const tipX = useMotionValue(0);
  const was = useRef<number | null>(null);
  useEffect(() => {
    if (at === null || at >= n) { was.current = null; return; }
    const L = layout[at];
    const left = at * (bw + g);
    const x = left - 3;
    const up = seen ? L.top : 0;
    const down = seen ? L.esc : 0;
    const y = height - LIFT - up - 3;
    const h = up + LIFT + 1 + LIFT + down + 6;
    /* beside the column: right while it fits there, else left */
    const right = left + bw + 8;
    const tx = right + TIP_W <= CW || left - 8 - TIP_W < 0
      ? Math.min(CW - TIP_W, right)
      : left - 8 - TIP_W;
    const go = (mv: typeof ringX, v: number) => {
      if (was.current === null) mv.set(v);
      else animate(mv, v, SPRING);
    };
    go(ringX, x); go(ringY, y); go(ringH, h); go(tipX, tx);
    was.current = at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, n, bw, g, mode, seen, height, CW]);

  const pick = (e: React.PointerEvent) => {
    const b = plot.current?.getBoundingClientRect();
    if (!b || b.width === 0) return;
    const i = Math.floor(((e.clientX - b.left) / b.width) * n);
    setAt(Math.max(0, Math.min(n - 1, i)));
  };

  const cur = at !== null && at < n ? data[at] : null;
  const top2 = cur
    ? cur.vals.map((v, k) => ({ v, k })).filter((c) => c.v > 0).sort((a, b) => b.v - a.v).slice(0, 2)
    : [];

  return (
    <div
      ref={root}
      className={className ? `stb ${className}` : "stb"}
      data-colour={colour === "Colour" ? "on" : "off"}
      data-scrub={cur ? "" : undefined}
      style={{ width: fluid ? "100%" : W, ["--stb-r" as string]: `${r}px`, ["--stb-rr" as string]: `${r + 3}px` } as CSSProperties}
    >
      <div className="stb-head">
        <div className="stb-titles">
          {/* the "Last 20 days" line is gone (2026-11-19): the axis dates
              and Day / Week already say the span */}
          <div className="stb-title">{title}</div>
        </div>
        {toggle ? <div className="stb-seg-ctl" data-mode={mode} role="tablist">
          <span className="stb-thumb" aria-hidden />
          {(["Day", "Week"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-on={mode === m || undefined}
              className="stb-tab"
              onClick={() => { setMode(m); }}
            >
              {m}
            </button>
          ))}
        </div> : null}
      </div>

      <div className="stb-figure">
        <span className="stb-num" aria-label={fmt(total)}>
          {fmt(total).split("").map((ch, i) => (
            <span key={`${gen}-${i}`} className="stb-digit" data-pop={gen > 0 || undefined} style={{ ["--i" as string]: i } as CSSProperties} aria-hidden>
              {ch}
            </span>
          ))}
        </span>
        <span className="stb-unit">{unit}</span>
      </div>

      <div
        ref={plot}
        className="stb-plot"
        style={{ height: height + 1 + BH }}
        onPointerDown={(e) => {
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* scripted */ }
          pick(e);
        }}
        onPointerMove={pick}
        onPointerUp={(e) => {
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* scripted */ }
          if (e.pointerType !== "mouse") setAt(null);
        }}
        onPointerCancel={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
      >
        <span className="stb-base" style={{ top: height }} />
        {data.map((_, i) => (
          <div
            key={i}
            className="stb-col"
            data-on={at === i || undefined}
            style={{ left: i * (bw + g), width: bw, ["--i" as string]: i } as CSSProperties}
          >
            {layout[i].segs.map((s, k) => (
              <span
                key={k}
                className="stb-bar"
                style={{
                  ["--c" as string]: tone(k),
                  bottom: BH + 1 + LIFT + (seen ? s.bottom : 0),
                  height: seen ? s.h : 0,
                } as CSSProperties}
              />
            ))}
            <span
              className="stb-esc"
              style={{ top: height + 1 + LIFT, height: seen ? layout[i].esc : 0 }}
            />
          </div>
        ))}

        <motion.span
          className="stb-ring"
          aria-hidden
          style={{ x: ringX, y: ringY, height: ringH, width: bw + 6 }}
        />

        <motion.div className="stb-tip" style={{ x: tipX, width: TIP_W }} aria-hidden={!cur}>
          {cur && (
            <>
              <div className="stb-tip-head">
                <span>{cur.label}</span>
                <b>{fmt(totals[at!])}</b>
              </div>
              {top2.map(({ v, k }) => (
                <div className="stb-tip-row" key={k}>
                  <i style={{ ["--c" as string]: tone(k) } as CSSProperties} />
                  <span>{categories[k]?.label}</span>
                  <b>{fmt(v)}</b>
                </div>
              ))}
              <div className="stb-tip-row" data-esc="">
                <i />
                <span>{escLabel}</span>
                <b>{cur.esc}</b>
              </div>
            </>
          )}
        </motion.div>
      </div>

      {n > 0 ? (
        <div className="stb-axis">
          <span>{data[0].short}</span>
          <span>{data[n - 1].short}</span>
        </div>
      ) : null}

      {legend ? (
        <ul className="stb-legend">
          {categories.map((c, k) => (
            <li key={k}>
              <i style={{ ["--c" as string]: tone(k) } as CSSProperties} />
              <span>{c.label}</span>
              <b>{fmt(sum(data.map((b) => b.vals[k] ?? 0)))}</b>
            </li>
          ))}
          <li data-esc="">
            <i />
            <span>{escLabel}</span>
            <b>{fmt(sum(data.map((b) => b.esc)))}</b>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
