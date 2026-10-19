// SMS through MSG91's Flow API. Indian operators only deliver DLT-registered
// templates, so the text goes out as one variable of an approved template.

const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow";
const BATCH = 100;

export type SmsConfig = {
  authKey: string;
  templateId: string;
  variable: string;
};

export function smsConfig(templateId?: string): SmsConfig | null {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  const template = templateId?.trim() || process.env.MSG91_TEMPLATE_ID?.trim();
  if (!authKey || !template) return null;
  return {
    authKey,
    templateId: template,
    variable: process.env.MSG91_TEMPLATE_VAR?.trim() || "message",
  };
}

export function smsAvailable(): boolean {
  return Boolean(process.env.MSG91_AUTH_KEY?.trim() && process.env.MSG91_TEMPLATE_ID?.trim());
}

/** GSM-7 fits 160 characters a part, 153 once split; anything else is UCS-2. */
export function smsSegments(text: string): { length: number; segments: number; unicode: boolean } {
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const length = [...text].length;
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  return { length, segments, unicode };
}

/**
 * Sends one text to many numbers, digits only with the country code. MSG91
 * accepts or refuses a request as a whole, so the result is per batch.
 */
export async function sendSms(
  config: SmsConfig,
  phones: string[],
  text: string
): Promise<{ phone: string; ok: boolean; error?: string }[]> {
  const results: { phone: string; ok: boolean; error?: string }[] = [];
  for (let at = 0; at < phones.length; at += BATCH) {
    const slice = phones.slice(at, at + BATCH);
    let error: string | undefined;
    try {
      const response = await fetch(MSG91_FLOW_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          authkey: config.authKey,
        },
        body: JSON.stringify({
          template_id: config.templateId,
          short_url: "0",
          recipients: slice.map((mobiles) => ({ mobiles, [config.variable]: text })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        type?: string;
        message?: string;
      } | null;
      if (!response.ok || payload?.type !== "success") {
        error = `MSG91 ${response.status}: ${payload?.message ?? "request refused"}`.slice(0, 300);
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "SMS could not be sent.";
    }
    for (const phone of slice) results.push({ phone, ok: !error, error });
  }
  return results;
}
