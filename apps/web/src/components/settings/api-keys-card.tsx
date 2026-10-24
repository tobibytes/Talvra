import type { ApiKey, CreatedApiKey } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/page";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
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
          Use Talvra from Claude or any app that supports MCP. A key lets the app read your courses,
          assignments and material, answer questions from them, make study aids and record flashcard
          reviews. It can't change your account, Canvas or homework submissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CopyField label="Server URL" value={mcpUrl()} />
        {keys.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
        ) : keys.data.keys.length ? (
          <ul className="divide-y rounded-lg border" aria-label="API keys">
            {keys.data.keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 p-3">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">…{k.last4}</span> · made{" "}
                    <span title={dateTime(k.createdAt)}>{relativeTime(k.createdAt)}</span> ·{" "}
                    {k.lastUsedAt ? (
                      <>
                        used{" "}
                        <span title={dateTime(k.lastUsedAt)}>{relativeTime(k.lastUsedAt)}</span>
                      </>
                    ) : (
                      "never used"
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke ${k.name}`}
                  onClick={() => setRevoking(k)}
                >
                  <Trash2 />
                  <span className="hidden sm:inline">Revoke</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No keys yet. Make one for each app you connect, so you can revoke them separately.
          </p>
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
              This is the only time it's shown. Treat it like a password: anyone with it can read
              your course material.
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
                Other apps: add a remote MCP server with the server URL and the header{" "}
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
            <DialogDescription>
              Apps using this key stop working with Talvra right away. This can't be undone.
            </DialogDescription>
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
            <DialogDescription>Name it after the app you'll use it in.</DialogDescription>
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
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>
                Shown in this list so you know which key is which.
              </FieldDescription>
            )}
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
