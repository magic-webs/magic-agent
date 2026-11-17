import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import { formatMoney } from "@/convex/lib/billing";
import { failureLabel } from "@/convex/lib/metaErrors";
import { pct } from "@/components/marketing/format";

Font.register({
  family: "Geist",
  fonts: [
    { src: "/fonts/Geist-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/Geist-SemiBold.ttf", fontWeight: 600 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const BRAND: Record<string, string> = {
  default: "#0c7d3e",
  amber: "#fdc700",
  emerald: "#007a55",
};

const INK = "#1c1c1a";
const MUTED = "#6b6b66";
const LINE = "#e6e6e1";
const SURFACE = "#f7f7f4";

type Stats = {
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  converted: number;
  optedOut: number;
};

export type CampaignPdfInput = {
  business: { name: string; logoSrc: string | null; theme?: string | null };
  campaign: {
    title: string;
    status: string;
    templateName: string | null;
    startedLabel: string;
    audiences: string[];
  };
  stats: Stats;
  readHours: number[];
  reasons: Array<{ code: string; count: number }>;
  cost: { micros: number; currency: string } | null;
};

function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? INK : "#ffffff";
}

function tint(hex: string, amount: number) {
  const mix = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * amount + 255 * (1 - amount)));
  return `#${mix.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

async function asPng(src: string | null): Promise<string | null> {
  if (!src) return null;
  try {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    await image.decode();
    const scale = Math.min(1, 400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function makeStyles(brand: string) {
  return StyleSheet.create({
    page: { fontFamily: "Geist", fontSize: 9, color: INK, paddingTop: 0, paddingBottom: 56, paddingHorizontal: 0 },
    band: { height: 6, backgroundColor: brand },
    body: { paddingHorizontal: 36 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: LINE },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: { height: 34, maxWidth: 110, objectFit: "contain" },
    monogram: { width: 34, height: 34, borderRadius: 8, backgroundColor: brand, color: readableOn(brand), fontSize: 15, fontWeight: 600, textAlign: "center", paddingTop: 8 },
    business: { fontSize: 13, fontWeight: 600 },
    kicker: { fontSize: 8, color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
    generated: { fontSize: 8, color: MUTED, textAlign: "right" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20 },
    title: { fontSize: 20, fontWeight: 600 },
    pill: { fontSize: 8, fontWeight: 600, color: brand === BRAND.amber ? INK : brand, backgroundColor: tint(brand, 0.14), paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
    meta: { color: MUTED, marginTop: 6, lineHeight: 1.4 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
    tile: { width: "32.2%", borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10 },
    tileAccent: { width: 18, height: 2, backgroundColor: brand, marginBottom: 6 },
    tileLabel: { fontSize: 7, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
    tileValue: { fontSize: 17, fontWeight: 600, marginTop: 4 },
    section: { marginTop: 18, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 14 },
    sectionTitle: { fontSize: 11, fontWeight: 600, marginBottom: 10 },
    note: { fontSize: 7.5, color: MUTED, marginTop: 8 },
    barRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
    barLabel: { width: 110, color: MUTED },
    barTrack: { flex: 1, height: 9, backgroundColor: SURFACE, borderRadius: 3 },
    barFill: { height: 9, backgroundColor: brand, borderRadius: 3 },
    barValue: { width: 90, textAlign: "right" },
    hours: { flexDirection: "row", alignItems: "flex-end", height: 90, gap: 2, borderBottomWidth: 1, borderBottomColor: LINE },
    hour: { flex: 1, backgroundColor: brand, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
    hourAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, color: MUTED, fontSize: 7 },
    tableRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
    tableHead: { color: MUTED, fontSize: 7, letterSpacing: 0.8, textTransform: "uppercase" },
    footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
    footerBrand: { flexDirection: "row", alignItems: "center", gap: 5, color: MUTED, fontSize: 7.5 },
    footerLogo: { height: 10, width: 18, objectFit: "contain" },
  });
}

function CampaignReportPdf({ input, logo, maLogo }: { input: CampaignPdfInput; logo: string | null; maLogo: string | null }) {
  const brand = BRAND[input.business.theme ?? "default"] ?? BRAND.default;
  const s = makeStyles(brand);
  const { stats, campaign } = input;
  const total = stats.sent + stats.failed;
  const rate = (part: number, whole: number) => `${pct(part, whole) ?? 0}%`;

  const tiles: Array<[string, string]> = [
    ["Total", total.toLocaleString()],
    ["Sent", stats.sent.toLocaleString()],
    ["Delivered", stats.delivered.toLocaleString()],
    ["Read", rate(stats.read, stats.sent)],
    ["Replied", rate(stats.replied, stats.sent)],
    ["Clicked", rate(stats.clicked, stats.sent)],
    ["Orders and bookings", stats.converted.toLocaleString()],
    ["Failed", stats.failed.toLocaleString()],
    ["Cost", input.cost ? formatMoney(input.cost.micros, input.cost.currency) : "—"],
  ];

  const funnel: Array<[string, number]> = [
    ["Total", total],
    ["Sent", stats.sent],
    ["Delivered", stats.delivered],
    ["Read", stats.read],
    ["Replied", stats.replied],
    ["Clicked", stats.clicked],
    ["Ordered or booked", stats.converted],
    ["Unsubscribed", stats.optedOut],
  ];

  const peak = Math.max(1, ...input.readHours);
  const failures = input.reasons.reduce((sum, row) => sum + row.count, 0);
  const generated = new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Document title={`${campaign.title} — campaign report`} author={input.business.name} creator="Magic Agent">
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.body}>
          <View style={s.header}>
            <View style={s.brandRow}>
              {logo ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={logo} style={s.logo} />
              ) : (
                <Text style={s.monogram}>{input.business.name.trim().charAt(0).toUpperCase()}</Text>
              )}
              <View>
                <Text style={s.business}>{input.business.name}</Text>
                <Text style={s.kicker}>Campaign report</Text>
              </View>
            </View>
            <Text style={s.generated}>Generated {generated}</Text>
          </View>

          <View style={s.titleRow}>
            <Text style={s.title}>{campaign.title}</Text>
            <Text style={s.pill}>{campaign.status}</Text>
          </View>
          <Text style={s.meta}>
            {[campaign.templateName ?? "No template", campaign.startedLabel, campaign.audiences.join(", ")]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>

          <View style={s.grid}>
            {tiles.map(([label, value]) => (
              <View key={label} style={s.tile} wrap={false}>
                <View style={s.tileAccent} />
                <Text style={s.tileLabel}>{label}</Text>
                <Text style={s.tileValue}>{value}</Text>
              </View>
            ))}
          </View>

          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>From send to reply</Text>
            {funnel.map(([label, value]) => (
              <View key={label} style={s.barRow}>
                <Text style={s.barLabel}>{label}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${total ? Math.max((value / total) * 100, value ? 0.8 : 0) : 0}%` }]} />
                </View>
                <Text style={s.barValue}>
                  {value.toLocaleString()} · {rate(value, total)}
                </Text>
              </View>
            ))}
            <Text style={s.note}>Read, replied and clicked rates on the tiles are of messages sent; the bars are of the total.</Text>
          </View>

          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>When people read it</Text>
            {stats.read === 0 ? (
              <Text style={{ color: MUTED }}>No reads yet.</Text>
            ) : (
              <>
                <View style={s.hours}>
                  {input.readHours.map((reads, hour) => (
                    <View key={hour} style={[s.hour, { height: `${Math.max((reads / peak) * 100, reads ? 2 : 0)}%` }]} />
                  ))}
                </View>
                <View style={s.hourAxis}>
                  {["0h", "4h", "8h", "12h", "16h", "20h", "24h+"].map((label) => (
                    <Text key={label}>{label}</Text>
                  ))}
                </View>
              </>
            )}
            <Text style={s.note}>Hours between sending and the blue ticks.</Text>
          </View>

          {input.reasons.length > 0 ? (
            <View style={s.section} wrap={false}>
              <Text style={s.sectionTitle}>Why some did not arrive</Text>
              <View style={s.tableRow}>
                <Text style={[s.tableHead, { flex: 1 }]}>Reason</Text>
                <Text style={[s.tableHead, { width: 60, textAlign: "right" }]}>Messages</Text>
                <Text style={[s.tableHead, { width: 50, textAlign: "right" }]}>Share</Text>
              </View>
              {input.reasons.map((row) => (
                <View key={row.code} style={s.tableRow}>
                  <Text style={{ flex: 1 }}>{failureLabel(row.code)}</Text>
                  <Text style={{ width: 60, textAlign: "right" }}>{row.count.toLocaleString()}</Text>
                  <Text style={{ width: 50, textAlign: "right", color: MUTED }}>{rate(row.count, failures)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={s.footer} fixed>
          <View style={s.footerBrand}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {maLogo ? <Image src={maLogo} style={s.footerLogo} /> : null}
            <Text>Prepared with Magic Agent</Text>
          </View>
          <Text style={{ color: MUTED, fontSize: 7.5 }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function campaignReportPdf(input: CampaignPdfInput): Promise<Blob> {
  const [logo, maLogo] = await Promise.all([asPng(input.business.logoSrc), asPng("/images/logo.png")]);
  return await pdf(<CampaignReportPdf input={input} logo={logo} maLogo={maLogo} />).toBlob();
}
