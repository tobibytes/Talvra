import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";
import { AuthCard, OrDivider } from "@/components/auth/auth-card";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordInput } from "@/components/auth/password-input";
import { LoaderCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient, authErrorMessage, configQuery, meQuery, safeRedirect } from "@/lib/auth";

export const Route = createFileRoute("/_auth/sign-in")({
  // Loose: an MCP connector's OAuth sign-in arrives with signed authorize params, which must
  // stay in the URL for the auth client to send back.
  validateSearch: z.looseObject({
    redirect: z.string().optional(),
    error: z.string().optional(),
  }),
  component: SignIn,
});

function SignIn() {
  const { redirect, error: oauthError } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    oauthError
      ? "Google sign-in didn't work. Use your Morgan Google account, or sign in with email."
      : null,
  );
  const [unverified, setUnverified] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setUnverified(false);
    const res = await authClient.signIn.email({ email, password });
    setPending(false);
    if (res.error) {
      if (res.error.status === 403) {
        setUnverified(true);
        setError("Confirm your email first. We sent you a link when you signed up.");
      } else {
        setError(
          res.error.status === 401
            ? "That email and password don't match."
            : authErrorMessage(res.error),
        );
      }
      return;
    }
    // In a connector's OAuth sign-in, the server says where the flow continues (consent).
    const next = (res.data as { url?: unknown } | null)?.url;
    if (typeof next === "string" && next) {
      window.location.assign(next);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    await navigate({ to: safeRedirect(redirect) });
  };

  const resend = async () => {
    const res = await authClient.sendVerificationEmail({ email, callbackURL: "/onboarding" });
    if (res.error) setError(authErrorMessage(res.error));
    else await navigate({ to: "/check-email", search: { email } });
  };

  return (
    <AuthCard
      title="Welcome back"
      description="Pick up where you left off."
      footer={
        <>
          New to Talvra?{" "}
          <Link
            to="/sign-up"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton callbackURL={safeRedirect(redirect)} />
      <GoogleDivider />
      <form onSubmit={submit} className="space-y-4">
        <Field>
          <FieldLabel htmlFor="email">Morgan email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@morgan.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              to="/forgot-password"
              search={{ email }}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            {unverified ? (
              <Button type="button" variant="outline" size="sm" onClick={resend}>
                Send the link again
              </Button>
            ) : null}
          </div>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

/** Only shows the divider when the Google button is there too. */
function GoogleDivider() {
  const config = useQuery(configQuery);
  return config.data?.googleEnabled ? <OrDivider /> : null;
}
