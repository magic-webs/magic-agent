import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  Building03Icon,
  Mortarboard01Icon,
  Stethoscope02Icon,
  Store01Icon,
} from "@hugeicons/core-free-icons";
import { Reveal } from "@/components/landing/reveal";

const CASES = [
  {
    icon: Store01Icon,
    title: "Shops & distributors",
    body: "Prices, stock and minimum orders from your catalogue, and orders taken in chat.",
    ask: "Do you deliver 20 cartons to Nashik?",
    tag: "Order filed",
  },
  {
    icon: Building03Icon,
    title: "Real estate",
    body: "Budget, location and timeline asked up front, and site visits booked.",
    ask: "Any 3BHK under 1.2 Cr in Wakad?",
    tag: "Visit booked",
  },
  {
    icon: Stethoscope02Icon,
    title: "Clinics & salons",
    body: "Services, timings and appointment requests with every detail your desk needs.",
    ask: "Is Dr Mehta free on Thursday evening?",
    tag: "Appointment",
  },
  {
    icon: Mortarboard01Icon,
    title: "Education",
    body: "Courses, fees and batches answered, and admissions enquiries qualified.",
    ask: "When does the next weekend batch start?",
    tag: "Lead qualified",
  },
];

export function UseCases() {
  return (
    <Reveal
      className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4"
      stagger
      distance={40}
    >
      {CASES.map(({ icon: Icon, title, body, ask, tag }) => (
        <Link
          key={title}
          href="/signup"
          className="group flex flex-col overflow-hidden rounded-[22px] border border-(--line) bg-(--surface) transition duration-500 ease-out hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-35px_rgb(20_40_80/0.45)]"
        >
          <div className="stage-mesh relative h-52 overflow-hidden">
            <div className="bg-dots absolute inset-0 transition-transform duration-900 ease-out group-hover:scale-110" />
            <span className="absolute top-4 left-4 flex size-10 items-center justify-center rounded-xl bg-(--surface)/85 backdrop-blur">
              <HugeiconsIcon icon={Icon} strokeWidth={2} className="size-5" />
            </span>
            <p className="absolute top-[42%] right-4 max-w-[80%] rounded-2xl rounded-tr-md bg-(--surface) px-3 py-2 text-[13px] leading-snug shadow-sm transition-transform duration-500 group-hover:-translate-y-1">
              {ask}
            </p>
            <span className="absolute bottom-4 left-4 rounded-full bg-(--ok) px-2.5 py-1 text-[11px] font-semibold text-white transition-transform duration-500 group-hover:-translate-y-1">
              {tag}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-5">
            <h3 className="flex items-center justify-between gap-2 font-display text-xl font-medium tracking-tight">
              {title}
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-4 text-(--ink-muted) transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </h3>
            <p className="text-sm leading-relaxed text-(--ink-muted)">{body}</p>
          </div>
        </Link>
      ))}
    </Reveal>
  );
}
