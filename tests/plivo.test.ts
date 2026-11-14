import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { callerNumber, formFields, plivoSignatureValid, signedBase } from "../convex/lib/plivo";

const TOKEN = "test-token-1234567890";

function sign(base: string, nonce: string) {
  return createHmac("sha256", TOKEN).update(`${base}.${nonce}`).digest("base64");
}

describe("plivo signature", () => {
  const url = "https://x.convex.site/plivo/answer/abc";
  const form = formFields("To=918031857999&From=918249159831&CallUUID=u-1");

  test("builds the POST base the way the SDK does", () => {
    expect(signedBase("POST", url, form)).toBe(
      "https://x.convex.site/plivo/answer/abc?CallUUIDu-1From918249159831To918031857999"
    );
    expect(signedBase("POST", `${url}?b=2&a=1`, form)).toBe(
      "https://x.convex.site/plivo/answer/abc?a=1&b=2.CallUUIDu-1From918249159831To918031857999"
    );
  });

  test("accepts a genuine signature and rejects a tampered body", async () => {
    const signature = sign(signedBase("POST", url, form), "n1");
    expect(await plivoSignatureValid(TOKEN, "POST", [url], form, signature, "n1")).toBe(true);
    const tampered = formFields("To=918031857999&From=919999999999&CallUUID=u-1");
    expect(await plivoSignatureValid(TOKEN, "POST", [url], tampered, signature, "n1")).toBe(false);
    expect(await plivoSignatureValid(TOKEN, "POST", [url], form, null, "n1")).toBe(false);
  });

  test("checks every candidate URL", async () => {
    const signature = sign(signedBase("POST", url, form), "n2");
    expect(
      await plivoSignatureValid(TOKEN, "POST", ["https://other/plivo/answer/abc", url], form, `x,${signature}`, "n2")
    ).toBe(true);
  });
});

describe("callerNumber", () => {
  test("normalises Plivo's From", () => {
    expect(callerNumber("918249159831")).toBe("+918249159831");
    expect(callerNumber("+91 82491 59831")).toBe("+918249159831");
    expect(callerNumber("anonymous")).toBe(null);
  });
});
