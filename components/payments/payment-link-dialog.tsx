"use client";

import { useState, type ReactElement } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { friendlyError } from "@/lib/errors";

export type PaymentLinkDefaults = {
  amount?: string;
  description?: string;
  recordReference?: string;
  name?: string;
  phone?: string;
  email?: string;
};

export function PaymentLinkDialog({
  trigger,
  defaults,
}: {
  trigger: ReactElement;
  defaults?: PaymentLinkDefaults;
}) {
  const workspace = useWorkspace();
  const createLink = useAction(api.payments.createLink);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Required<PaymentLinkDefaults>>(() => blank(defaults));

  const set = (key: keyof PaymentLinkDefaults, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      const amount = form.amount.trim() ? Number(form.amount.replace(/[^\d.]/g, "")) : undefined;
      const result = await createLink({
        workspaceId: workspace._id,
        amount,
        description: form.description,
        recordReference: form.recordReference.trim() || undefined,
        customerName: form.name.trim() || undefined,
        customerPhone: form.phone.trim() || undefined,
        customerEmail: form.email.trim() || undefined,
      });
      await navigator.clipboard.writeText(result.url).catch(() => undefined);
      toast.add({
        title: `Payment link for ${result.amount} created`,
        description: `${result.url} — copied to your clipboard.`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: friendlyError(error, "Could not create the link."),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(blank(defaults));
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New payment link</DialogTitle>
          <DialogDescription>
            A Razorpay link the customer can pay by UPI, card or netbanking.
            With an order reference, it is matched to the order and the amount
            can be left blank to charge its total.
          </DialogDescription>
        </DialogHeader>

        <form
          id="payment-link-form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-amount">Amount (₹)</Label>
              <Input
                id="pl-amount"
                inputMode="decimal"
                placeholder="1499.00"
                value={form.amount}
                onChange={(event) => set("amount", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-reference">Order reference</Label>
              <Input
                id="pl-reference"
                placeholder="ORD-0012"
                value={form.recordReference}
                onChange={(event) => set("recordReference", event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pl-description">
              What it is for <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pl-description"
              placeholder="Order ORD-0012 — 2 × Oak chair"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Name"
              aria-label="Customer name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
            />
            <Input
              placeholder="Phone"
              aria-label="Customer phone"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
            />
            <Input
              placeholder="Email"
              aria-label="Customer email"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="payment-link-form"
            disabled={saving || !form.description.trim()}
          >
            {saving ? <Spinner /> : null}
            Create link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blank(defaults?: PaymentLinkDefaults): Required<PaymentLinkDefaults> {
  return {
    amount: defaults?.amount ?? "",
    description: defaults?.description ?? "",
    recordReference: defaults?.recordReference ?? "",
    name: defaults?.name ?? "",
    phone: defaults?.phone ?? "",
    email: defaults?.email ?? "",
  };
}
