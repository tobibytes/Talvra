import type { AidSlot, StudyAid, StudyAidKind } from "@talvra/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { modelLabel } from "@/lib/model-label";
import { relativeTime } from "@/lib/time";

const copy: Record<StudyAidKind, { noun: string; make: string; pitch: string; working: string }> = {
  notes: {
    noun: "study notes",
    make: "Make study notes",
    pitch: "A summary with key terms, linked to the source pages.",
    working: "Writing your notes…",
  },
  flashcards: {
    noun: "flashcards",
    make: "Make flashcards",
    pitch: "Cards scheduled for review so they stick.",
    working: "Picking what's worth remembering…",
  },
  quiz: {
    noun: "practice quiz",
    make: "Make a practice quiz",
    pitch: "Practice questions with explanations.",
    working: "Writing questions…",
  },
};

const inFlight = (a: StudyAid | null) => a?.status === "queued" || a?.status === "generating";

export function useGenerateAid(documentId: string, kind: StudyAidKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (regenerate: boolean) => api.generateAid(documentId, kind, regenerate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["document", documentId, "aids"] }),
    onError: (err) => toast.error(err.message),
  });
}

/**
 * Shared shell for Notes / Flashcards / Quiz: the empty pitch, the in-progress
 * state, failures (keeping the last good version visible), and regenerate.
 */
export function AidPanel({
  documentId,
  kind,
  slot,
  children,
}: {
  documentId: string;
  kind: StudyAidKind;
  slot: AidSlot;
  children: (aid: StudyAid) => React.ReactNode;
}) {
  const generate = useGenerateAid(documentId, kind);
  const [confirm, setConfirm] = React.useState(false);
  const c = copy[kind];
  const { current, latest } = slot;
  const working = inFlight(latest) || generate.isPending;
  const failedNewer = latest?.status === "failed" && latest.id !== current?.id ? latest : null;

  if (!current) {
    if (working) return <Working text={c.working} />;
    return (
      <Card className="mx-auto max-w-lg items-center gap-4 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold">{c.make}</h2>
          <p className="text-sm text-muted-foreground">{c.pitch}</p>
        </div>
        {failedNewer ? (
          <p role="alert" className="text-sm text-destructive">
            {failedNewer.error ?? "The last try didn't work."}
          </p>
        ) : null}
        <Button onClick={() => generate.mutate(false)}>
          <Sparkles /> {failedNewer ? "Try again" : c.make}
        </Button>
        <p className="text-xs text-muted-foreground">Made by AI from this document only.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {working ? <Working text={`Making a new version… ${c.working}`} compact /> : null}
      {failedNewer && !working ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>The new version didn't work</AlertTitle>
          <AlertDescription>
            {failedNewer.error ?? "Try again later."} Showing the previous version.
          </AlertDescription>
        </Alert>
      ) : null}
      {children(current)}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
        <span>
          Version {current.version}, made {relativeTime(current.updatedAt)} by{" "}
          {modelLabel(current.model)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={working}>
          <RefreshCw /> Make a new version
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make new {c.noun}?</DialogTitle>
            <DialogDescription>
              {kind === "flashcards"
                ? "A fresh deck replaces these cards. Your review history stays."
                : "The current one stays until the new one is ready."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                setConfirm(false);
                generate.mutate(true);
              }}
            >
              <Sparkles /> Make new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Working({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <Card
      className={
        compact
          ? "flex-row items-center gap-3 p-4"
          : "mx-auto max-w-lg items-center gap-3 p-8 text-center"
      }
    >
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
      <p className="text-sm" role="status" aria-live="polite">
        {text}
        {compact ? null : (
          <span className="mt-1 block text-xs text-muted-foreground">
            Usually under a minute. It keeps going if you leave.
          </span>
        )}
      </p>
    </Card>
  );
}
