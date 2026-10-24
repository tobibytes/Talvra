import { ConnectCanvas, type ConnectCanvasResult, DEFAULT_CANVAS_URL } from "@talvra/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { ChevronDown, ExternalLink, LoaderCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiRequestError, api } from "@/lib/api";
import { meQuery } from "@/lib/auth";

/** Paste-a-token form. The token is checked with Canvas before it's saved. */
export function ConnectCanvasForm({
  onConnected,
  submitLabel = "Connect Canvas",
  initialBaseUrl = DEFAULT_CANVAS_URL,
}: {
  onConnected: (result: ConnectCanvasResult) => void;
  submitLabel?: string;
  initialBaseUrl?: string;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(initialBaseUrl);
  const [showAdvanced, setShowAdvanced] = React.useState(initialBaseUrl !== DEFAULT_CANVAS_URL);
  const [errors, setErrors] = React.useState<{ token?: string; baseUrl?: string; form?: string }>(
    {},
  );

  const connect = useMutation({
    mutationFn: api.connectCanvas,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      onConnected(result);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.fieldError("token")) {
        setErrors({ token: err.message });
      } else {
        setErrors({ form: err.message });
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ConnectCanvas.safeParse({ token, baseUrl });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      setErrors({
        token: issues.find((i) => i.path[0] === "token")?.message,
        baseUrl: issues.find((i) => i.path[0] === "baseUrl")?.message,
      });
      if (issues.some((i) => i.path[0] === "baseUrl")) setShowAdvanced(true);
      return;
    }
    setErrors({});
    connect.mutate({ token: parsed.data.token, baseUrl: parsed.data.baseUrl });
  };

  const tokenPage = `${safeOrigin(baseUrl)}/profile/settings`;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-foreground">
        <li>
          Open{" "}
          <a
            href={tokenPage}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            Canvas → Account → Settings <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
        <li>
          Under “Approved Integrations”, choose{" "}
          <strong className="text-foreground">+ New Access Token</strong>.
        </li>
        <li>Name it “Talvra” and copy the token.</li>
      </ol>

      <Field data-invalid={errors.token ? true : undefined}>
        <FieldLabel htmlFor="canvas-token">Canvas access token</FieldLabel>
        <PasswordInput
          id="canvas-token"
          autoComplete="off"
          spellCheck={false}
          placeholder="1234~abcd…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={errors.token ? true : undefined}
          aria-describedby="canvas-token-help"
        />
        <FieldDescription id="canvas-token-help">
          Stored encrypted. Talvra only reads your courses.
        </FieldDescription>
        <FieldError errors={[{ message: errors.token }]} />
      </Field>

      <div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <ChevronDown
            className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            aria-hidden
          />
          Not at Morgan State?
        </button>
        {showAdvanced ? (
          <Field className="mt-3" data-invalid={errors.baseUrl ? true : undefined}>
            <FieldLabel htmlFor="canvas-url">Canvas address</FieldLabel>
            <Input
              id="canvas-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              aria-invalid={errors.baseUrl ? true : undefined}
            />
            <FieldError errors={[{ message: errors.baseUrl }]} />
          </Field>
        ) : null}
      </div>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={connect.isPending}>
        {connect.isPending ? (
          <>
            <LoaderCircle className="animate-spin" /> Checking with Canvas…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return DEFAULT_CANVAS_URL;
  }
}
