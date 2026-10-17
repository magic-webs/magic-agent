export type PaymentToolSpec = {
  name: string;
  label: string;
  summary: string;
};

export const PAYMENT_TOOLS: PaymentToolSpec[] = [
  {
    name: "create_payment_link",
    label: "Create payment link",
    summary:
      "Creates a Razorpay payment link for an agreed amount or a filed order's total, and sends the customer the URL.",
  },
  {
    name: "check_payment_status",
    label: "Check payment status",
    summary:
      "Looks up whether a payment link from this conversation, or for an order, has been paid.",
  },
];

export const PAYMENT_TOOL_NAMES: string[] = PAYMENT_TOOLS.map((tool) => tool.name);

export const RAZORPAY_LINK_EVENTS = [
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.expired",
  "payment_link.cancelled",
];

export const PAYMENT_LINK_STATUSES = [
  "created",
  "partially_paid",
  "paid",
  "expired",
  "cancelled",
] as const;

export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export const isFinalStatus = (status: string) =>
  status === "paid" || status === "expired" || status === "cancelled";

export const DEFAULT_LINK_EXPIRY_HOURS = 72;
export const MAX_LINK_EXPIRY_HOURS = 24 * 30;

export function razorpayWebhookUrl(siteUrl: string, inboundKey: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/payments/razorpay/${inboundKey}`;
}

export function razorpayKeyMode(keyId: string): "live" | "test" | null {
  if (/^rzp_live_[A-Za-z0-9]+$/.test(keyId)) return "live";
  if (/^rzp_test_[A-Za-z0-9]+$/.test(keyId)) return "test";
  return null;
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function paymentPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.replace(/\D/g, "").length >= 8 ? digits : undefined;
}
