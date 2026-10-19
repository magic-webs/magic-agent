const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo rejects more than 100 messages in one request. */
const BATCH = 100;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: string;
  channelId: string;
  priority: "default" | "high";
  data: Record<string, unknown>;
};

/** Whether each message was accepted, in order, and the tokens Expo says are gone. */
export async function sendExpo(
  messages: ExpoMessage[]
): Promise<{ accepted: boolean[]; dead: string[] }> {
  const accepted: boolean[] = new Array(messages.length).fill(false);
  const dead: string[] = [];

  for (let at = 0; at < messages.length; at += BATCH) {
    const slice = messages.slice(at, at + BATCH);
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Optional, and only needed once push security is enabled on the
          // Expo account. Absent is the normal case.
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(slice),
      });
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      payload.data?.forEach((ticket, index) => {
        if (ticket.status === "ok") {
          accepted[at + index] = true;
          return;
        }
        // The install is gone — uninstalled, or the token rotated. Expo will
        // keep rejecting it, so stop sending to it.
        if (ticket.details?.error === "DeviceNotRegistered") {
          const message = slice[index];
          if (message) dead.push(message.to);
        }
      });
    } catch {
      // Counted as not accepted.
    }
  }

  return { accepted, dead };
}
