import type { AiModelList, AiProvider, AiSettings } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { IconTile, StatusPill } from "@/components/blocks";
import { ExternalLink, KeyRound, LoaderCircle, Sparkles } from "@/components/icons";
import { ErrorState } from "@/components/page";
import { Facts, TileRow } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const PROVIDERS: Record<AiProvider, { name: string; keysUrl: string; hint: string }> = {
  anthropic: {
    name: "Anthropic (Claude)",
    keysUrl: "https://console.anthropic.com/settings/keys",
    hint: "Starts with sk-ant-",
  },
  openai: {
    name: "OpenAI",
    keysUrl: "https://platform.openai.com/api-keys",
    hint: "Starts with sk-",
  },
};

export const aiQueryKey = ["me", "ai"] as const;

export function AiCard() {
  const queryClient = useQueryClient();
  const ai = useQuery({ queryKey: aiQueryKey, queryFn: api.aiSettings });
  const [dialog, setDialog] = React.useState<null | "key" | "remove">(null);
  const remove = useMutation({
    mutationFn: api.removeAiKey,
    onSuccess: (s) => {
      queryClient.setQueryData(aiQueryKey, s);
      setDialog(null);
      toast("Back to Talvra's AI");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>AI model</h2>
        </CardTitle>
        <CardDescription>Powers your study aids and answers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ai.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : ai.isError ? (
          <ErrorState error={ai.error} onRetry={() => ai.refetch()} />
        ) : ai.data.source === "own" ? (
          <OwnKey
            s={ai.data}
            onChange={() => setDialog("key")}
            onRemove={() => setDialog("remove")}
          />
        ) : (
          <TalvraAi s={ai.data} onUseOwn={() => setDialog("key")} />
        )}
      </CardContent>

      <Dialog open={dialog === "key"} onOpenChange={(o) => setDialog(o ? "key" : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use your own API key</DialogTitle>
            <DialogDescription>
              Stored encrypted and used only for you. Your provider bills you.
            </DialogDescription>
          </DialogHeader>
          <KeyForm
            initialProvider={ai.data?.provider ?? "anthropic"}
            onSaved={(s) => {
              queryClient.setQueryData(aiQueryKey, s);
              setDialog(null);
              toast.success("Your key is set up");
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "remove"} onOpenChange={(o) => setDialog(o ? "remove" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop using your key?</DialogTitle>
            <DialogDescription>You'll go back to Talvra's AI, with daily limits.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Keep my key
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? <LoaderCircle className="animate-spin" /> : null}
              Remove my key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TalvraAi({ s, onUseOwn }: { s: AiSettings; onUseOwn: () => void }) {
  return (
    <>
      <TileRow
        className="-mx-2 items-start"
        tile={<IconTile icon={Sparkles} />}
        title="Talvra's AI, free with daily limits"
        meta={`${s.defaults.standard}, and ${s.defaults.advanced} for notes and Ask. A basic model takes over after the daily limit.`}
      />
      <Button variant="outline" onClick={onUseOwn}>
        <KeyRound /> Use my own API key
      </Button>
    </>
  );
}

function OwnKey({
  s,
  onChange,
  onRemove,
}: {
  s: AiSettings;
  onChange: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Facts
        items={[
          {
            label: "Status",
            value:
              s.status === "active" ? (
                <StatusPill tone="ok">Using your key</StatusPill>
              ) : (
                <StatusPill tone="stop">Not working, using Talvra's AI</StatusPill>
              ),
          },
          { label: "Provider", value: s.provider ? PROVIDERS[s.provider].name : "" },
          { label: "Model", value: <span className="font-mono">{s.model}</span> },
          { label: "Key", value: <span className="font-mono">••••{s.keyLast4}</span> },
        ]}
      />
      {s.status !== "active" && s.lastError ? (
        <p role="alert" className="text-sm text-destructive">
          {s.lastError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onChange}>
          {s.status === "active" ? "Change key or model" : "Replace key"}
        </Button>
        <Button variant="destructive" onClick={onRemove}>
          Stop using my key
        </Button>
      </div>
    </>
  );
}

function KeyForm({
  initialProvider,
  onSaved,
}: {
  initialProvider: AiProvider;
  onSaved: (s: AiSettings) => void;
}) {
  const [provider, setProvider] = React.useState<AiProvider>(initialProvider);
  const [apiKey, setApiKey] = React.useState("");
  const [models, setModels] = React.useState<AiModelList | null>(null);
  const [model, setModel] = React.useState("");
  const keyId = React.useId();
  const modelId = React.useId();

  const check = useMutation({
    mutationFn: () => api.aiModels({ provider, apiKey }),
    onSuccess: (list) => {
      setModels(list);
      setModel(list.suggested ?? list.models[0]?.id ?? "");
    },
  });
  const save = useMutation({
    mutationFn: () => api.saveAiKey({ provider, apiKey, model }),
    onSuccess: onSaved,
  });
  const reset = () => {
    setModels(null);
    check.reset();
    save.reset();
  };
  const info = PROVIDERS[provider];
  const error = check.error ?? save.error;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (models) save.mutate();
        else check.mutate();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Provider</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={p === provider ? "default" : "outline"}
              aria-pressed={p === provider}
              onClick={() => {
                setProvider(p);
                reset();
              }}
            >
              {PROVIDERS[p].name}
            </Button>
          ))}
        </div>
      </fieldset>

      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={keyId}>API key</FieldLabel>
        <Input
          id={keyId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={info.hint}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setApiKey(e.target.value);
            if (models) reset();
          }}
        />
        <FieldDescription>
          <a
            href={info.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Get a key from {info.name} <ExternalLink className="size-3" aria-hidden />
          </a>
        </FieldDescription>
        {error ? <FieldError>{error.message}</FieldError> : null}
      </Field>

      {models ? (
        <Field>
          <FieldLabel htmlFor={modelId}>Model</FieldLabel>
          <select
            id={modelId}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={cn(
              "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            )}
          >
            {models.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name === m.id ? m.id : `${m.name} (${m.id})`}
              </option>
            ))}
          </select>
          <FieldDescription>Bigger models do better and cost more.</FieldDescription>
        </Field>
      ) : null}

      <DialogFooter>
        <Button
          type="submit"
          disabled={apiKey.trim().length < 20 || check.isPending || save.isPending}
        >
          {check.isPending || save.isPending ? <LoaderCircle className="animate-spin" /> : null}
          {models ? "Save" : "Check key"}
        </Button>
      </DialogFooter>
    </form>
  );
}
