import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { convexServerClient, errorMessage } from "@/lib/convex-server";
import { describeUserAgent } from "@/lib/device";
import {
  SIGNUP_COOKIE,
  setSessionCookies,
  signupCookieOptions,
} from "@/lib/session";

type Body = {
  /** Without a mode, the form's details start a sign-up and email a code. */
  mode?: "verify" | "resend";
  name?: string;
  businessName?: string;
  email?: string;
  password?: string;
  timezone?: string;
  locale?: string;
  brief?: string;
  code?: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

function restartOf(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return Boolean(data && typeof data === "object" && "restart" in data && data.restart);
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const convex = convexServerClient();
  const jar = await cookies();
  const challenge = jar.get(SIGNUP_COOKIE)?.value;

  try {
    if (body.mode === "verify" || body.mode === "resend") {
      if (!challenge) {
        return NextResponse.json(
          { error: "This sign-up has expired. Start again.", restart: true },
          { status: 400 }
        );
      }
      if (body.mode === "resend") {
        const { email } = await convex.action(api.auth.resendSignUpCode, { challenge });
        return NextResponse.json({ step: "verify", email });
      }

      const done = await convex.action(api.auth.finishSignUp, {
        challenge,
        code: text(body.code) ?? "",
        device: describeUserAgent(request.headers.get("user-agent")),
      });
      jar.delete(SIGNUP_COOKIE);
      setSessionCookies(jar, done.sessionToken, "user", done.workspaceSlug);
      return NextResponse.json({
        ok: true,
        redirectTo: `/w/${done.workspaceSlug}/onboarding`,
      });
    }

    const started = await convex.action(api.auth.startSignUp, {
      name: text(body.name) ?? "",
      businessName: text(body.businessName) ?? "",
      email: text(body.email) ?? "",
      password: text(body.password) ?? "",
      timezone: text(body.timezone),
      locale: text(body.locale),
      brief: text(body.brief),
    });
    jar.set({ name: SIGNUP_COOKIE, value: started.challenge, ...signupCookieOptions() });
    return NextResponse.json({ step: "verify", email: started.email });
  } catch (error) {
    const restart = restartOf(error);
    if (restart) jar.delete(SIGNUP_COOKIE);
    return NextResponse.json({ error: errorMessage(error), restart }, { status: 400 });
  }
}
