import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const read = (path: string) => readFileSync(join(process.cwd(), path));
const markUri = `data:image/png;base64,${read("public/images/logo.png").toString("base64")}`;
const regular = read("public/fonts/Geist-Regular.ttf");
const semibold = read("public/fonts/Geist-SemiBold.ttf");

const GREEN = "#16a34a";

export function ogCard({
  eyebrow,
  title,
  subtitle,
  cta,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  cta?: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #ffffff 0%, #f0fdf4 60%, #dcfce7 100%)",
          fontFamily: "Geist",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markUri} width={108} height={60} alt="" />
          <div style={{ fontSize: 36, fontWeight: 600 }}>Magic Agent</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: GREEN,
              textTransform: "uppercase",
              letterSpacing: 3,
            }}
          >
            {eyebrow}
          </div>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
            {title}
          </div>
          <div style={{ fontSize: 32, color: "#475569", lineHeight: 1.35, maxWidth: 940 }}>{subtitle}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 28, color: "#64748b" }}>agent.magicwebs.ai</div>
          {cta ? (
            <div
              style={{
                display: "flex",
                padding: "18px 36px",
                borderRadius: 999,
                background: GREEN,
                color: "#ffffff",
                fontSize: 30,
                fontWeight: 600,
              }}
            >
              {cta}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    }
  );
}
