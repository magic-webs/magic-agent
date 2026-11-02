import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The agent faces: head-and-shoulders photos on transparent backgrounds, so
 * they are cut out over a tinted circle rather than boxed into a photo frame.
 */

export type AgentGender = "male" | "female";

export const AGENT_FACES = [
  { name: "Sakhi", role: "Customer Support Agent", gender: "female", src: "/images/agents/sakhi.png" },
  { name: "Vani", role: "Ad Qualification Agent", gender: "female", src: "/images/agents/vaani.png" },
  { name: "Ayesha", role: "Front Desk (Reception)", gender: "female", src: "/images/agents/ayesha.png" },
  { name: "Meera", role: "Marketing", gender: "female", src: "/images/agents/meera.png" },
  { name: "Aarti", role: "Front Desk", gender: "female", src: "/images/agents/aarti.png" },
  { name: "Arjun", role: "Meeting Manager", gender: "male", src: "/images/agents/arjun.png" },
  { name: "Vikram", role: "Sales Agent", gender: "male", src: "/images/agents/vikram.png" },
  { name: "Arth", role: "Quotation Agent", gender: "male", src: "/images/agents/arth.png" },
  { name: "Suchit", role: "Notifier", gender: "male", src: "/images/agents/suchit.png" },
  { name: "Samay", role: "Follow Up", gender: "male", src: "/images/agents/samay.png" },
] as const satisfies readonly { name: string; role: string; gender: AgentGender; src: string }[];

const BY_NAME = new Map<string, string>([
  ...AGENT_FACES.map((face) => [face.name.toLowerCase(), face.src] as const),
  ["vaani", "/images/agents/vaani.png"],
]);

const FEMALE = AGENT_FACES.filter((face) => face.gender === "female").map((face) => face.src);
const MALE = AGENT_FACES.filter((face) => face.gender === "male").map((face) => face.src);
const EITHER = AGENT_FACES.map((face) => face.src);

/** Stable, and only has to be stable — not well distributed. */
function hashOf(name: string): number {
  const seed = name.trim().toLowerCase() || "agent";
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return hash;
}

/**
 * Which face an agent gets: its own photo when the bot name is one of the
 * named agents, otherwise one hashed on the name from the set its gender picks.
 */
export function agentAvatarSrc(
  name: string,
  gender?: AgentGender | null
): string {
  const named = BY_NAME.get(name.trim().toLowerCase());
  if (named) return named;
  const set = gender === "female" ? FEMALE : gender === "male" ? MALE : EITHER;
  return set[hashOf(name) % set.length];
}

/** Tints for the circle behind the cutout, picked off the same hash. */
const TINTS = [
  "bg-amber-100 dark:bg-amber-500/15",
  "bg-emerald-100 dark:bg-emerald-500/15",
  "bg-sky-100 dark:bg-sky-500/15",
  "bg-violet-100 dark:bg-violet-500/15",
  "bg-rose-100 dark:bg-rose-500/15",
  "bg-teal-100 dark:bg-teal-500/15",
] as const;

/** The face filling a positioned box, cut out over whatever is behind it. */
export function AgentPortrait({
  name,
  gender,
  className,
}: {
  name: string;
  gender?: AgentGender | null;
  className?: string;
}) {
  return (
    <Image
      src={agentAvatarSrc(name, gender)}
      alt=""
      fill
      sizes="320px"
      className={cn("object-cover object-top", className)}
    />
  );
}

export function AgentAvatar({
  name,
  gender,
  size = 56,
  className,
}: {
  name: string;
  gender?: AgentGender | null;
  size?: number;
  className?: string;
}) {
  const src = agentAvatarSrc(name, gender);
  const tint = TINTS[hashOf(name) % TINTS.length];

  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        tint,
        className
      )}
    >
      {/* Oversized and pushed down: the busts are framed head-and-shoulders, so
          scaling to fit leaves the head small and floating in the circle.
          Filling it and cropping at the shoulders reads as a portrait. */}
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        style={{
          width: size * 1.18,
          height: size * 1.18,
          marginTop: size * 0.14,
        }}
        className="max-w-none object-contain"
      />
    </span>
  );
}
