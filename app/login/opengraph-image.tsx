import { OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Sign in to your Magic Agent workspace";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Your workspace is ready",
    title: "Sign in to Magic Agent",
    subtitle: "Use the email and password you were sent to open your workspace, agents and inbox.",
    cta: "Sign in",
  });
}
