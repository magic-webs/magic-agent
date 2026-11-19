"use client";

import { useState, useSyncExternalStore } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  FingerPrintAddIcon,
  FingerPrintIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";
import { describeUserAgent } from "@/lib/device";

const noop = () => () => {};

function ago(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function PasskeysCard({ className }: { className?: string }) {
  const passkeys = useQuery(api.passkeysDb.myPasskeys);
  const begin = useAction(api.auth.beginPasskeyRegistration);
  const finish = useAction(api.auth.finishPasskeyRegistration);
  const rename = useMutation(api.passkeysDb.renamePasskey);
  const remove = useMutation(api.passkeysDb.removePasskey);
  const supported = useSyncExternalStore(
    noop,
    browserSupportsWebAuthn,
    () => true
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (passkeys === null) return null;

  const add = async () => {
    setAdding(true);
    try {
      const optionsJSON = await begin({});
      const response = await startRegistration({ optionsJSON });
      await finish({
        response,
        name: describeUserAgent(navigator.userAgent),
      });
      toast.add({ title: "Passkey added", type: "success" });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        toast.add({
          title: "Could not add the passkey",
          description: friendlyError(error),
          type: "error",
        });
      }
    } finally {
      setAdding(false);
    }
  };

  const saveName = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await rename({ passkeyId: editing.id, name: editing.name });
      setEditing(null);
    } catch (error) {
      toast.add({ title: "Could not rename", description: friendlyError(error), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const drop = async (id: string) => {
    try {
      await remove({ passkeyId: id });
      toast.add({ title: "Passkey removed", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not remove", description: friendlyError(error), type: "error" });
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={FingerPrintIcon} strokeWidth={2} className="size-4" /> Passkeys
        </CardTitle>
        <CardDescription>
          Sign in with your fingerprint, face or screen lock instead of a
          password. A passkey works on the web and in the Magic Agent app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {passkeys === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {passkeys.map((passkey) => (
              <li key={passkey._id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{passkey.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {ago(passkey.createdAt)}
                    {passkey.lastUsedAt ? ` · used ${ago(passkey.lastUsedAt)}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Rename"
                  onClick={() => setEditing({ id: passkey._id, name: passkey.name })}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove"
                  onClick={() => void drop(passkey._id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {supported ? (
          <Button variant="outline" className="self-start" onClick={() => void add()} disabled={adding}>
            {adding ? <Spinner /> : <HugeiconsIcon icon={FingerPrintAddIcon} strokeWidth={2} />} Add a passkey
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">This browser does not support passkeys.</p>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="passkey-name">Name</Label>
            <Input
              id="passkey-name"
              autoFocus
              maxLength={60}
              value={editing?.name ?? ""}
              onChange={(event) =>
                setEditing((prev) => (prev ? { ...prev, name: event.target.value } : prev))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveName()} disabled={saving || !editing?.name.trim()}>
              {saving ? <Spinner /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
