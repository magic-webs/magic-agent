export const INTAKE_ASK_NAME = "Before we start, what's your name?";

export function intakeAskPhone(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return `Thanks, ${firstName}! What number can we reach you on?`;
}
