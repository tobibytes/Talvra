import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { authClient, authErrorMessage } from "@/lib/auth";

export const Route = createFileRoute("/_auth/reset-password")({
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!token || linkError) {
    return (
      <AuthCard title="This link has expired" description="Reset links work once, within an hour.">
        <Button render={<Link to="/forgot-password" />}>Send a new link</Button>
      </AuthCard>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setPending(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (res.error) {
      setError(authErrorMessage(res.error));
      return;
    }
    toast.success("Password changed. Sign in with your new password.");
    await navigate({ to: "/sign-in" });
  };

  return (
    <AuthCard
      title="Choose a new password"
      description="You'll be signed out on your other devices."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldError errors={[{ message: error ?? undefined }]} />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}
