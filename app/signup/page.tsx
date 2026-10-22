"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Logo } from "@/components/logo";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react";

type Reply = {
  step?: "verify";
  email?: string;
  redirectTo?: string;
  error?: string;
  restart?: boolean;
};

class SignUpError extends Error {
  constructor(message: string, readonly restart: boolean) {
    super(message);
  }
}

async function post(payload: Record<string, string | undefined>): Promise<Reply> {
  const response = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as Reply;
  if (!response.ok) {
    throw new SignUpError(data.error ?? "Sign-up failed.", Boolean(data.restart));
  }
  return data;
}

function browserRegion() {
  try {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    };
  } catch {
    return {};
  }
}

function Field({
  id,
  label,
  ...props
}: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

function SignUpForm() {
  const params = useSearchParams();
  const [form, setForm] = useState({
    name: "",
    businessName: "",
    email: "",
    password: "",
    brief: params.get("brief")?.slice(0, 2000) ?? "",
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set =(key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const run = async (payload: Record<string, string | undefined>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reply = await post(payload);
      if (reply.redirectTo) {
        window.location.assign(reply.redirectTo);
        return;
      }
      if (sentTo && payload.mode === "resend") setNotice("A new code is on its way.");
      setSentTo(reply.email ?? form.email);
      setCode("");
    } catch (caught) {
      if (caught instanceof SignUpError && caught.restart) setSentTo(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      setCode("");
    }
    setBusy(false);
  };

  const start = () => {
    if (busy) return;
    void run({
      name: form.name,
      businessName: form.businessName,
      email: form.email,
      password: form.password,
      brief: form.brief.trim() || undefined,
      ...browserRegion(),
    });
  };

  const verify = (value = code) => {
    if (value.length !== 6 || busy) return;
    void run({ mode: "verify", code: value });
  };

  const ready =
    form.name.trim() && form.businessName.trim() && form.email.trim() && form.password;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <Logo className="h-6" />
        <span className="font-heading text-base font-semibold tracking-tight">
          Magic Agent
        </span>
      </Link>

      <Card className="w-full max-w-sm">
        {sentTo ? (
          <>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                Enter the six-digit code sent to{" "}
                <span className="font-medium text-foreground">{sentTo}</span>. It
                works for 15 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Could not verify</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {notice ? (
                <p className="text-sm text-muted-foreground">{notice}</p>
              ) : null}

              <div className="flex justify-center py-1">
                <InputOTP
                  autoFocus
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={setCode}
                  onComplete={(value: string) => verify(value)}
                  disabled={busy}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot key={index} index={index} className="size-11 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button onClick={() => verify()} disabled={busy || code.length !== 6}>
                {busy ? <Spinner /> : <ShieldCheckIcon />} Create my workspace
              </Button>

              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => void run({ mode: "resend" })}
                  disabled={busy}
                >
                  Send a new code
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setSentTo(null);
                    setError(null);
                    setNotice(null);
                  }}
                  disabled={busy}
                >
                  Use a different email
                </button>
              </div>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Create your agent</CardTitle>
              <CardDescription>
                Start with a free trial and credit in your wallet. No card needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error ? (
                <Alert variant="destructive">
                  <WarningIcon />
                  <AlertTitle>Could not sign up</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Field
                id="name"
                label="Your name"
                autoComplete="name"
                autoFocus
                value={form.name}
                onChange={(event) => set("name")(event.target.value)}
              />
              <Field
                id="business"
                label="Business name"
                autoComplete="organization"
                value={form.businessName}
                onChange={(event) => set("businessName")(event.target.value)}
              />
              <Field
                id="email"
                label="Work email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => set("email")(event.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <InputGroup>
                  <InputGroupInput
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                    value={form.password}
                    onChange={(event) => set("password")(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && ready) start();
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>
              {form.brief ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="brief">What your agent should do</Label>
                  <Textarea
                    id="brief"
                    rows={3}
                    value={form.brief}
                    onChange={(event) => set("brief")(event.target.value)}
                  />
                </div>
              ) : null}

              <Button onClick={start} disabled={busy || !ready}>
                {busy ? <Spinner /> : <ArrowRightIcon />} Continue
              </Button>

              <p className="text-xs text-muted-foreground">
                By continuing you agree to the{" "}
                <Link href="/terms" className="underline underline-offset-2">
                  terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline underline-offset-2">
                  privacy policy
                </Link>
                .
              </p>
            </CardContent>
          </>
        )}
      </Card>

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </main>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}
