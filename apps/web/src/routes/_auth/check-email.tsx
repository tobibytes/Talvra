import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";
import { AuthCard } from "@/components/auth/auth-card";
import { MailCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/_auth/check-email")({
  validateSearch: z.object({ email: z.string().optional() }),
  component: CheckEmail,
});

function CheckEmail() {
  const { email } = Route.useSearch();
  const [status, setStatus] = React.useState<string | null>(null);

  const resend = async () => {
    if (!email) return;
    const res = await authClient.sendVerificationEmail({ email, callbackURL: "/onboarding" });
    setStatus(
      res.error ? authErrorMessage(res.error) : "Sent. Check your inbox (and junk folder).",
    );
  };

  return (
    <AuthCard
      title="Check your email"
      description={
        email ? (
          <>
            We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
          </>
        ) : (
          "We sent you a confirmation link."
        )
      }
      footer={
        <Link to="/sign-in" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-primary/14 text-primary">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">Open it on this device within 24 hours.</p>
      </div>
      {email ? (
        <Button variant="outline" onClick={resend}>
          Resend the link
        </Button>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
    </AuthCard>
  );
}
