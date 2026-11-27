import type { Metadata } from "next";
import { shareMetadata } from "@/lib/share";

export const metadata: Metadata = shareMetadata(
  "Sign in — Magic Agent",
  "Your Magic Agent workspace is ready. Sign in with the email and password you were sent."
);

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
