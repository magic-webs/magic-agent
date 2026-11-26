const FAREWELL_WORDS = new Set([
  "thanks", "thank", "thanku", "thankyou", "thnx", "thnks", "thx", "thanx", "tx", "ty", "tq", "tqsm", "tysm",
  "bye", "byee", "goodbye", "tc",
  "dhanyavad", "dhanyawad", "dhanyavaad", "shukriya",
  "धन्यवाद", "शुक्रिया",
]);

const ACK_WORDS = new Set([
  "ok", "okay", "okey", "okk", "okkk", "k", "kk", "oki", "okie",
  "great", "good", "nice", "cool", "fine", "alright", "allright", "noted", "got", "perfect", "awesome",
  "theek", "thik", "accha", "acha", "achha", "achcha",
  "ठीक", "अच्छा",
]);

const FILLER_WORDS = new Set([
  "you", "u", "it", "so", "much", "very", "a", "lot", "sir", "madam", "mam", "maam", "ji", "hai", "h", "he",
  "and", "for", "the", "help", "info", "information", "dear", "bro", "take", "care", "all", "is", "that",
  "है", "जी",
]);

const FAREWELL_EMOJI = /[\u{1F64F}\u{1F44B}]/u;
const CLOSING_EMOJI =
  /[\u{1F44D}\u{1F64F}\u{1F44C}\u{1F60A}\u{1F642}\u{2764}\u{2705}\u{1F44F}\u{1F600}\u{1F601}\u{1F91D}\u{1F4AF}\u{1F44B}\u{263A}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

/**
 * A message that only closes the chat: "ok thank you", "thanks 🙏", "bye".
 * After a question a bare "ok" may be a yes, so only thanks or goodbye count.
 */
export function isClosingMessage(text: string, afterQuestion: boolean): boolean {
  const stripped = text.replace(CLOSING_EMOJI, " ");
  const farewellEmoji = FAREWELL_EMOJI.test(text);
  const words = stripped
    .toLowerCase()
    .replace(/[.!,'"~\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return stripped !== text && (farewellEmoji || !afterQuestion);
  if (words.length > 8) return false;
  const known = (word: string) => FAREWELL_WORDS.has(word) || ACK_WORDS.has(word) || FILLER_WORDS.has(word);
  if (!words.every(known)) return false;
  if (farewellEmoji || words.some((word) => FAREWELL_WORDS.has(word))) return true;
  return !afterQuestion && words.some((word) => ACK_WORDS.has(word));
}

export function asksSomething(text: string): boolean {
  return text.includes("?");
}
