import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as React from "react";
import { BrandMark, heroGlow } from "@/components/auth/auth-card";
import { IconTile } from "@/components/blocks";
import { BookOpen, CircleX, KeyRound, Sparkles } from "@/components/icons";
import { ErrorState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, meQuery } from "@/lib/auth";

/**
 * OAuth consent for MCP connectors (ChatGPT, Claude, ...). Better Auth sends the student here
 * from /api/auth/oauth2/authorize with signed query params; the auth client sends them back with
 * the answer, and the server replies with where to go next (the connector's redirect).
 */
export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    return { me };
  },
  component: Consent,
});

type PublicClient = { client_id: string; client_name?: string; client_uri?: string };

const CAN = [
  { icon: BookOpen, text: "Read your courses, assignments and course material" },
  { icon: Sparkles, text: "Answer questions from your material and make study aids" },
  { icon: KeyRound, text: "Record your flashcard reviews" },
];

function Consent() {
  const { me } = Route.useRouteContext();
  const search = Route.useSearch() as Record<string, unknown>;
  const clientId = typeof search.client_id === "string" ? search.client_id : "";
  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: async () => {
      const res = await authClient.$fetch<PublicClient>("/oauth2/public-client", {
        query: { client_id: clientId },
      });
      if (res.error) throw new Error(res.error.message ?? "This app isn't registered.");
      return res.data;
    },
    enabled: !!clientId,
  });
  const [pending, setPending] = React.useState<"allow" | "deny" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const name = client.data?.client_name?.trim() || "This app";

  const answer = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setError(null);
    // The auth client adds the signed oauth_query from this page's URL.
    const res = await authClient.$fetch<{ url?: string }>("/oauth2/consent", {
      method: "POST",
      body: { accept },
    });
    if (res.error || !res.data?.url) {
      setPending(null);
      setError(
        res.error?.message ?? "That didn't go through. Start connecting again from the app.",
      );
      return;
    }
    window.location.assign(res.data.url);
  };

  return (
    <main className="relative grid min-h-svh place-items-center px-4 py-10" style={heroGlow}>
      <div className="w-full max-w-md animate-rise space-y-6">
        <BrandMark />
        {!clientId ? (
          <ErrorState error={new Error("This link is missing the app's details.")} />
        ) : client.isPending ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : client.isError ? (
          <ErrorState error={client.error} onRetry={() => client.refetch()} />
        ) : (
          <section
            aria-labelledby="consent-title"
            className="space-y-5 rounded-xl border bg-card p-6"
          >
            <div className="space-y-2">
              <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
                Connect an app
              </p>
              <h1
                id="consent-title"
                className="font-display text-2xl leading-tight font-extrabold tracking-tight"
              >
                {name} wants to use your Talvra
              </h1>
              {client.data?.client_uri ? (
                <p className="truncate text-sm text-muted-foreground">{client.data.client_uri}</p>
              ) : null}
            </div>
            <ul className="grid gap-2" aria-label="It will be able to">
              {CAN.map((c) => (
                <li key={c.text} className="flex items-center gap-3 text-sm">
                  <IconTile icon={c.icon} />
                  {c.text}
                </li>
              ))}
              <li className="flex items-center gap-3 text-sm text-muted-foreground">
                <IconTile icon={CircleX} className="bg-secondary text-muted-foreground" />
                It can't change your account, Canvas or homework submissions
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{me.user.email}</span>.
              Disconnect any time in Settings.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={!!pending} onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button disabled={!!pending} onClick={() => answer(true)}>
                {pending === "allow" ? "Connecting…" : `Allow ${name}`}
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
