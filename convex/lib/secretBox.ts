import { ConvexError } from "convex/values";

const VERSION = "v1";
const encoder = new TextEncoder();

export function secretBoxReady(): boolean {
  return Boolean(process.env.INTEGRATIONS_SECRET_KEY?.trim());
}

async function boxKey(): Promise<CryptoKey> {
  const secret = process.env.INTEGRATIONS_SECRET_KEY?.trim();
  if (!secret) {
    console.error("secretBox: INTEGRATIONS_SECRET_KEY is not set");
    throw new ConvexError("This integration is not available right now.");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export async function sealSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await boxKey(),
    encoder.encode(plain)
  );
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

export async function openSecret(sealed: string): Promise<string> {
  const [version, iv, cipher] = sealed.split(":");
  if (version !== VERSION || !iv || !cipher) {
    throw new ConvexError("A stored credential could not be read. Connect again.");
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      await boxKey(),
      fromBase64(cipher)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new ConvexError("A stored credential could not be read. Connect again.");
  }
}
