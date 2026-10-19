type Channel = "whatsapp" | "instagram" | "web" | string;

const NAME: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  rcs: "RCS",
  telegram: "Telegram",
};

/** A provider's send error, reworded for the person who pressed send. */
export function friendlySendError(channel: Channel, raw: string | undefined): string {
  const name = NAME[channel] ?? "The channel";
  if (!raw) return `${name} did not accept the message. Try again.`;
  const text = raw.toLowerCase();

  if (
    /outside of allowed window|131047|re-?engagement|more than 24 hours|24-hour/.test(text)
  ) {
    return channel === "whatsapp"
      ? "It has been more than 24 hours since the customer last wrote, so WhatsApp won't deliver a normal message. Send an approved template, or wait for them to write again."
      : `It has been more than 24 hours since the customer last wrote, so ${name} won't deliver this message. Wait for them to write again.`;
  }
  if (/131026|not a valid whatsapp|unable to deliver|incapable/.test(text)) {
    return "This number can't receive WhatsApp messages.";
  }
  if (/bot was blocked|user is deactivated|chat not found/.test(text)) {
    return `This person has blocked or left the ${name} bot, so it can't message them.`;
  }
  if (/user not found|no matching user|isn't available|not available right now/.test(text)) {
    return `This person can't receive messages on ${name} right now.`;
  }
  if (/131056|130429|rate limit|too many|throttl|request limit/.test(text)) {
    return `${name} is limiting how fast messages can be sent. Wait a minute and try again.`;
  }
  if (/http 401|unauthorized|access token|oauth|session has expired|\b190\b|131031|account is locked/.test(text)) {
    return `The ${name} connection needs attention. Reconnect it from Channels, then try again.`;
  }
  if (/131051|not supported|unsupported/.test(text)) {
    return `${name} doesn't support this kind of message.`;
  }
  if (/131053|media could not/.test(text)) {
    return `${name} couldn't load the attachment. Try sending it again.`;
  }
  if (/131048|spam/.test(text)) {
    return `${name} paused sending from this account because too many messages were reported. Try again later.`;
  }
  if (/http 5\d\d|fetch failed|network|timed? ?out|econn|131000/.test(text)) {
    return `${name} couldn't be reached just now. Try again in a moment.`;
  }

  const said = raw.replace(/^HTTP \d{3}:\s*/i, "").trim();
  return said && said !== "no response body"
    ? `${name} didn't accept the message: ${said.charAt(0).toUpperCase()}${said.slice(1)}`
    : `${name} didn't accept the message. Try again.`;
}
