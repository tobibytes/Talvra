import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient, authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/_auth/forgot-password")({
  validateSearch: z.object({ email: z.string().optional() }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const search = Route.useSearch();
  const [email, setEmail] = React.useState(search.email ?? "");
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (res.error) setError(authErrorMessage(res.error));
    else setSent(true);
  };

  return (
    <AuthCard
      title="Reset your password"
      description={sent ? undefined : "We'll email you a link to choose a new one."}
      footer={
        <Link to="/sign-in" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-center text-sm">
          If an account exists for <strong>{email}</strong>, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="email">Morgan email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
