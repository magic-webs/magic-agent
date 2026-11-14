// Plivo's V3 request signature, as its SDK builds it (plivo-node utils/v3Security):
// the URL with its query sorted, then for a POST each form field as key+value
// in key order, then "." and the nonce, HMAC-SHA256 with the auth token.

function sortedQuery(params: Map<string, string[]>): string {
  return [...params.keys()]
    .sort()
    .flatMap((key) => [...params.get(key)!].sort().map((value) => `${key}=${value}`))
    .join("&");
}

export function signedBase(method: string, url: string, form: Map<string, string[]>): string {
  const parsed = new URL(url);
  const query = new Map<string, string[]>();
  parsed.searchParams.forEach((value, key) => query.set(key, [...(query.get(key) ?? []), value]));
  const base = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const queryString = sortedQuery(query);

  if (method === "GET" || form.size === 0) {
    return queryString ? `${base}?${queryString}` : base;
  }
  let head = `${base}?${queryString}`;
  if (queryString) head += ".";
  const body = [...form.keys()]
    .sort()
    .flatMap((key) => [...form.get(key)!].sort().map((value) => `${key}${value}`))
    .join("");
  return head + body;
}

async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function plivoSignatureValid(
  authToken: string,
  method: string,
  urls: string[],
  form: Map<string, string[]>,
  signatureHeader: string | null,
  nonce: string | null
): Promise<boolean> {
  if (!signatureHeader || !nonce) return false;
  const offered = signatureHeader.split(",").map((s) => s.trim());
  for (const url of urls) {
    const expected = await hmacBase64(authToken, `${signedBase(method, url, form)}.${nonce}`);
    if (offered.includes(expected)) return true;
  }
  return false;
}

export function formFields(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  new URLSearchParams(body).forEach((value, key) => out.set(key, [...(out.get(key) ?? []), value]));
  return out;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const SILENCE_SECONDS = 2;
export const MAX_TURN_SECONDS = 30;

export const plivoXml = {
  respond: (...parts: string[]) =>
    new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`, {
      headers: { "Content-Type": "application/xml" },
    }),
  play: (url: string) => `<Play>${escapeXml(url)}</Play>`,
  speak: (text: string) => `<Speak voice="WOMAN" language="en-US">${escapeXml(text)}</Speak>`,
  record: (action: string) =>
    `<Record action="${escapeXml(action)}" method="POST" redirect="true" fileFormat="mp3" playBeep="false" timeout="${SILENCE_SECONDS}" maxLength="${MAX_TURN_SECONDS}" finishOnKey="#"/>`,
  wait: (seconds: number) => `<Wait length="${seconds}"/>`,
  redirect: (url: string) => `<Redirect method="POST">${escapeXml(url)}</Redirect>`,
  hangup: () => "<Hangup/>",
};

export function callerNumber(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 8 ? `+${digits}` : null;
}
