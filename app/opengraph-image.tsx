import { OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Magic Agent — AI agents that answer your customers";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "WhatsApp · Instagram · Web chat",
    title: "AI agents that answer your customers",
    subtitle: "From your own prices and policies, with every detail collected and handed over as a finished enquiry.",
    cta: "Start free",
  });
}
