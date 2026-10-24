import type { ApiKey, ConnectedApp, CreatedApiKey } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { IconTile } from "@/components/blocks";
import { Check, Copy, KeyRound, Link2, Plus, Trash2, Unplug } from "@/components/icons";
import { ErrorState } from "@/components/page";
import { TileRow } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, api } from "@/lib/api";
import { dateTime, relativeTime } from "@/lib/time";

const keysQueryKey = ["me", "api-keys"] as const;

export const mcpUrl = () => `${window.location.origin}/api/mcp`;

/** A read-only value with a copy button (the MCP URL, a new key, a setup command). */
function CopyField({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const id = React.useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          className={mono ? "font-mono text-xs" : undefined}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Couldn't copy. Select the text and copy it.");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </Field>
  );
}

/** Apps connected over OAuth, each with Disconnect. */
function ConnectedApps() {
  const queryClient = useQueryClient();
  const apps = useQuery({ queryKey: ["me", "connected-apps"], queryFn: api.connectedApps });
  const [leaving, setLeaving] = React.useState<ConnectedApp | null>(null);
  const disconnect = useMutation({
    mutationFn: (clientId: string) => api.disconnectApp(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "connected-apps"] });
      setLeaving(null);
      toast("Disconnected");
    },
    onError: (err) => toast.error(err.message),
  });
  if (apps.isPending) return <Skeleton className="h-12 w-full" />;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;
  if (!apps.data.apps.length) return null;
  return (
    <>
      <ul className="-mx-2 grid gap-0.5" aria-label="Connected apps">
        {apps.data.apps.map((a) => (
          <li key={a.clientId}>
            <TileRow
              tile={<IconTile icon={Link2} />}
              title={a.name}
              meta={
                <span title={dateTime(a.connectedAt)}>Connected {relativeTime(a.connectedAt)}</span>
              }
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Disconnect ${a.name}`}
                  onClick={() => setLeaving(a)}
                >
                  <Unplug />
                  <span className="hidden sm:inline">Disconnect</span>
                </Button>
              }
            />
          </li>
        ))}
      </ul>
      <Dialog open={!!leaving} onOpenChange={(o) => (o ? null : setLeaving(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {leaving?.name}?</DialogTitle>
            <DialogDescription>It loses access within 15 minutes.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() => leaving && disconnect.mutate(leaving.clientId)}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApiKeysCard() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: keysQueryKey, queryFn: api.apiKeys });
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keysQueryKey });
      setRevoking(null);
      toast("Key revoked");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>AI assistants (MCP)</h2>
        </CardTitle>
        <CardDescription>
          Use Talvra from ChatGPT, Claude or another MCP app. It can read your material and make
          study aids, but can't change your account or Canvas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CopyField label="Server URL" value={mcpUrl()} />
        <p className="text-sm text-muted-foreground">
          ChatGPT and claude.ai: add the URL as a connector and sign in. Apps without sign-in: use a
          key below.
        </p>
        <ConnectedApps />
        {keys.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
        ) : keys.data.keys.length ? (
          <ul className="-mx-2 grid gap-0.5" aria-label="API keys">
            {keys.data.keys.map((k) => (
              <li key={k.id}>
                <TileRow
                  tile={<IconTile icon={KeyRound} />}
                  title={k.name}
                  meta={
                    <span className="flex flex-wrap gap-x-3">
                      <span className="font-mono">…{k.last4}</span>
                      <span title={dateTime(k.createdAt)}>Made {relativeTime(k.createdAt)}</span>
                      {k.lastUsedAt ? (
                        <span title={dateTime(k.lastUsedAt)}>
                          Used {relativeTime(k.lastUsedAt)}
                        </span>
                      ) : (
                        <span>Never used</span>
                      )}
                    </span>
                  }
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${k.name}`}
                      onClick={() => setRevoking(k)}
                    >
                      <Trash2 />
                      <span className="hidden sm:inline">Revoke</span>
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No keys yet. Make one per app.</p>
        )}
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New key
        </Button>
      </CardContent>

      <NewKeyDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(k) => {
          queryClient.invalidateQueries({ queryKey: keysQueryKey });
          setCreating(false);
          setCreated(k);
        }}
      />

      <Dialog open={!!created} onOpenChange={(o) => (o ? null : setCreated(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy your key now</DialogTitle>
            <DialogDescription>
              It's shown only once. Anyone with it can read your material.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-4">
              <CopyField label="API key" value={created.secret} />
              <CopyField
                label="Claude Code"
                value={`claude mcp add --transport http talvra ${mcpUrl()} --header "Authorization: Bearer ${created.secret}"`}
              />
              <p className="text-xs text-muted-foreground">
                Other apps: the server URL plus the header{" "}
                <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revoking} onOpenChange={(o) => (o ? null : setRevoking(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.name}?</DialogTitle>
            <DialogDescription>Apps using it stop working right away.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: CreatedApiKey) => void;
}) {
  const [name, setName] = React.useState("");
  const create = useMutation({
    mutationFn: () => api.createApiKey({ name }),
    onSuccess: (k) => {
      setName("");
      onCreated(k);
    },
  });
  const error =
    create.error instanceof ApiRequestError
      ? (create.error.fieldError("name") ?? create.error.message)
      : create.error?.message;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>Name it after the app that will use it.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
            <Input
              id="api-key-name"
              value={name}
              maxLength={60}
              placeholder="Claude Desktop"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Make key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
