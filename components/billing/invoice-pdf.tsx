import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import { formatMoney } from "@/convex/lib/billing";

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

export type InvoicePdfInput = {
  theme?: string | null;
  billedTo: {
    name: string;
    gstin: string;
    email: string;
    phone: string;
    address: string;
    state: string;
  };
  payment: {
    invoiceNumber: string;
    purpose: string;
    description: string;
    currency: string;
    subtotalMicros: number;
    gstMicros: number;
    totalMicros: number;
    paidAt: number;
    periodStart?: number;
    periodEnd?: number;
    method?: string;
    razorpayPaymentId?: string;
  };
};

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? INK : "#ffffff";
}

function tint(hex: string, amount: number) {
  const mix = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * amount + 255 * (1 - amount)));
  return `#${mix.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

async function asPng(src: string): Promise<string | null> {
  try {
    const image = new window.Image();
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
  const accent = brand === BRAND.amber ? INK : brand;
  return StyleSheet.create({
    page: { fontFamily: "Geist", fontSize: 9, color: INK, paddingBottom: 56 },
    band: { height: 6, backgroundColor: brand },
    body: { paddingHorizontal: 40 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 28, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: LINE },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: { height: 30, width: 30, objectFit: "contain" },
    monogram: { width: 30, height: 30, borderRadius: 8, backgroundColor: brand, color: readableOn(brand), fontSize: 14, fontWeight: 600, textAlign: "center", paddingTop: 7 },
    issuer: { fontSize: 13, fontWeight: 600 },
    issuerLine: { fontSize: 8, color: MUTED, marginTop: 2 },
    title: { fontSize: 22, fontWeight: 600, textAlign: "right", color: accent },
    pill: { alignSelf: "flex-end", marginTop: 6, fontSize: 8, fontWeight: 600, color: accent, backgroundColor: tint(brand, 0.14), paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
    parties: { flexDirection: "row", gap: 16, marginTop: 22 },
    block: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 12 },
    label: { fontSize: 7, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
    strong: { fontSize: 11, fontWeight: 600, marginBottom: 3 },
    line: { color: MUTED, lineHeight: 1.45 },
    metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    table: { marginTop: 22, borderWidth: 1, borderColor: LINE, borderRadius: 8 },
    thead: { flexDirection: "row", backgroundColor: tint(brand, 0.08), paddingVertical: 8, paddingHorizontal: 12, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
    th: { fontSize: 7, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
    row: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 12 },
    totals: { marginTop: 14, marginLeft: "auto", width: 220 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
    grand: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, backgroundColor: brand, color: readableOn(brand) },
    grandText: { fontSize: 11, fontWeight: 600, color: readableOn(brand) },
    note: { marginTop: 28, fontSize: 8, color: MUTED, lineHeight: 1.5 },
    footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, fontSize: 7.5, color: MUTED },
  });
}

function InvoicePdf({ input, logo }: { input: InvoicePdfInput; logo: string | null }) {
  const brand = BRAND[input.theme ?? "default"] ?? BRAND.default;
  const s = makeStyles(brand);
  const { billedTo, payment } = input;
  const money = (micros: number) => formatMoney(micros, payment.currency, payment.currency === "INR" ? "en-IN" : undefined);
  const number = payment.invoiceNumber;
  const gstPercent = payment.subtotalMicros > 0 ? Math.round((payment.gstMicros / payment.subtotalMicros) * 100) : 0;
  const period =
    payment.periodStart && payment.periodEnd ? `${DAY.format(payment.periodStart)} – ${DAY.format(payment.periodEnd)}` : null;
  const contact = [billedTo.email, billedTo.phone].filter(Boolean).join("  ·  ");
  const place = [billedTo.address, billedTo.state].filter(Boolean).join(", ");

  return (
    <Document title={`Invoice ${number}`} author="Magic Agent" creator="Magic Agent">
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.body}>
          <View style={s.header}>
            <View style={s.brandRow}>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              {logo ? <Image src={logo} style={s.logo} /> : <Text style={s.monogram}>M</Text>}
              <View>
                <Text style={s.issuer}>Magic Agent</Text>
                <Text style={s.issuerLine}>by Magicwebs · agent.magicwebs.ai</Text>
              </View>
            </View>
            <View>
              <Text style={s.title}>Invoice</Text>
              <Text style={s.pill}>Paid</Text>
            </View>
          </View>

          <View style={s.parties}>
            <View style={s.block}>
              <Text style={s.label}>Billed to</Text>
              <Text style={s.strong}>{billedTo.name}</Text>
              {billedTo.gstin ? <Text style={s.line}>GSTIN {billedTo.gstin}</Text> : null}
              {place ? <Text style={s.line}>{place}</Text> : null}
              {contact ? <Text style={s.line}>{contact}</Text> : null}
            </View>
            <View style={s.block}>
              <Text style={s.label}>Details</Text>
              <View style={s.metaRow}>
                <Text style={s.line}>Invoice no.</Text>
                <Text>{number}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.line}>Date</Text>
                <Text>{DAY.format(payment.paidAt)}</Text>
              </View>
              {payment.method ? (
                <View style={s.metaRow}>
                  <Text style={s.line}>Paid by</Text>
                  <Text style={{ textTransform: "capitalize" }}>{payment.method}</Text>
                </View>
              ) : null}
              {payment.razorpayPaymentId ? (
                <View style={s.metaRow}>
                  <Text style={s.line}>Payment ID</Text>
                  <Text>{payment.razorpayPaymentId}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={s.table}>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 1 }]}>Description</Text>
              <Text style={[s.th, { width: 110, textAlign: "right" }]}>Amount</Text>
            </View>
            <View style={s.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontWeight: 600 }}>{payment.description}</Text>
                <Text style={[s.line, { marginTop: 2 }]}>{period ? `${payment.purpose} · ${period}` : payment.purpose}</Text>
              </View>
              <Text style={{ width: 110, textAlign: "right" }}>{money(payment.subtotalMicros)}</Text>
            </View>
          </View>

          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text style={s.line}>Subtotal</Text>
              <Text>{money(payment.subtotalMicros)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.line}>{gstPercent ? `GST (${gstPercent}%)` : "GST"}</Text>
              <Text>{money(payment.gstMicros)}</Text>
            </View>
            <View style={s.grand}>
              <Text style={s.grandText}>Total paid</Text>
              <Text style={s.grandText}>{money(payment.totalMicros)}</Text>
            </View>
          </View>

          <Text style={s.note}>Thank you for your payment. This invoice was generated from your Magic Agent billing history.</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>Magic Agent · {number}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function invoicePdf(input: InvoicePdfInput): Promise<Blob> {
  const logo = await asPng("/images/logo.png");
  return await pdf(<InvoicePdf input={input} logo={logo} />).toBlob();
}
