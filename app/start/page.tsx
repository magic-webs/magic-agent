"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Logo } from "@/components/logo";
import { useSession } from "@/components/use-session";

const MAGICWEBS_URL =
  process.env.NEXT_PUBLIC_MAGICWEBS_URL || "https://build.magicwebs.ai";

/**
 * Where a personal account lands when it has no workspace in its session
 * cookie: one opened on Magicwebs before its first website, or one whose
 * workspaces were all added after it signed in here.
 */
export default function StartPage() {
  const router = useRouter();
  const workspaces = useQuery(api.workspaces.mine);
  const { signOut } = useSession();
  const first = workspaces?.[0];

  useEffect(() => {
    if (first) router.replace(`/w/${first.slug}`);
  }, [first, router]);

  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 px-4 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Logo className="h-6" />
        {workspaces === undefined || first ? (
          <Spinner />
        ) : (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>No workspace yet</CardTitle>
              <CardDescription>
                Each website you build on Magicwebs gets its own workspace here,
                with an agent ready to answer its visitors. Create your first
                website to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button nativeButton={false} render={<a href={`${MAGICWEBS_URL}/dashboard`} />}>
                Open Magicwebs
              </Button>
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
