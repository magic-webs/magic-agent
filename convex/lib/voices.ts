export const VOICE_SPEECH_MODEL = "elevenlabs/eleven-flash-v2.5";
export const VOICE_TRANSCRIPTION_MODEL = "elevenlabs/scribe-v2";

export const MAX_VOICE_NOTE_BYTES = 4 * 1024 * 1024;
export const MAX_SPOKEN_CHARS = 1500;

export type Voice = { id: string; name: string; gender: "female" | "male"; accent: string };

export const VOICES: Voice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", accent: "American, calm" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "female", accent: "American, upbeat" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", gender: "female", accent: "British, clear" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "female", accent: "American, warm" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "female", accent: "American, friendly" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "female", accent: "British, soft" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "male", accent: "British, warm" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male", accent: "American, deep" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "male", accent: "British, steady" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "male", accent: "American, smooth" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "male", accent: "American, casual" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "male", accent: "American, friendly" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male", accent: "American, young" },
];

export function isVoiceId(id: string): boolean {
  return VOICES.some((voice) => voice.id === id);
}

export function voiceIdFor(agent: { voiceId?: string; gender?: "male" | "female" }): string {
  if (agent.voiceId && isVoiceId(agent.voiceId)) return agent.voiceId;
  return agent.gender === "male" ? "JBFqnCBsd6RMkjVDRZzb" : "21m00Tcm4TlvDq8ikWAM";
}

export function spokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_`#>~|]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}
