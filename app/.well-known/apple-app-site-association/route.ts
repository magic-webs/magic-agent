const APPLE_APP_ID = "5PL3A8CMAJ.ai.magicagent.app";

export function GET() {
  return Response.json({ webcredentials: { apps: [APPLE_APP_ID] } });
}
