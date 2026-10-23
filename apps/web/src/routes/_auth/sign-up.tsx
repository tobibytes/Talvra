import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { AuthCard, OrDivider } from "@/components/auth/auth-card";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient, authErrorMessage, configQuery } from "@/lib/auth";

export const Route = createFileRoute("/_auth/sign-up")({ component: SignUp });

const MIN_PASSWORD = 10;

function SignUp() {
  const navigate = useNavigate();
  const config = useQuery(configQuery);
  const domains = config.data?.allowedEmailDomains ?? ["morgan.edu"];
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<{
    name?: string;
    email?: string;
    password?: string;
    form?: string;
  }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Enter your name.";
    const domain = email.trim().toLowerCase().split("@")[1];
    if (!domain || !domains.includes(domain)) next.email = `Use your @${domains[0]} email.`;
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const res = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      callbackURL: "/onboarding",
    });
    setPending(false);
    if (res.error) {
      setErrors({ form: authErrorMessage(res.error) });
      return;
    }
    await navigate({ to: "/check-email", search: { email: email.trim() } });
  };

  return (
    <AuthCard
      title="Create your account"
      description={`For Morgan State students. You'll need your @${domains[0]} email.`}
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/sign-in"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {config.data?.googleEnabled ? (
        <>
          <GoogleButton />
          <OrDivider />
        </>
      ) : null}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError errors={[{ message: errors.name }]} />
        </Field>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Morgan email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={`you@${domains[0]}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
          />
          <FieldError errors={[{ message: errors.email }]} />
        </Field>
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby="password-help"
          />
          <FieldDescription id="password-help">
            At least {MIN_PASSWORD} characters. A short phrase works well.
          </FieldDescription>
          <FieldError errors={[{ message: errors.password }]} />
        </Field>
        {errors.form ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
