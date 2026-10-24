import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CircleAlert,
  Clapperboard,
  LoaderCircle,
  NotebookPen,
  RefreshCw,
} from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Narrated slideshow made from the document's notes, with captions. */
export function VideoPanel({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ["document", documentId, "video"],
    queryFn: () => api.videoState(documentId),
    refetchInterval: (q) =>
      q.state.data?.video?.status === "queued" || q.state.data?.video?.status === "rendering"
        ? 4000
        : false,
  });
  const make = useMutation({
    mutationFn: () => api.makeVideo(documentId),
    onSuccess: (video) =>
      queryClient.setQueryData(["document", documentId, "video"], { video, notesReady: true }),
    onError: (err) => toast.error(err.message),
  });

  if (state.isPending) return <ListSkeleton rows={2} />;
  if (state.isError) return <ErrorState error={state.error} onRetry={() => state.refetch()} />;
  const { video, notesReady } = state.data;

  if (!notesReady) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="Make notes first"
        description="Videos are narrated from your notes."
        action={
          <Button
            render={
              <Link to="/documents/$documentId" params={{ documentId }} search={{ tab: "notes" }} />
            }
          >
            Go to Notes
          </Button>
        }
      />
    );
  }
  if (video?.status === "queued" || video?.status === "rendering" || make.isPending) {
    return (
      <Card className="mx-auto max-w-lg gap-5 p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-primary/14 text-primary">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          </span>
          <p className="text-sm" role="status" aria-live="polite">
            <span className="font-semibold">
              {video?.status === "rendering"
                ? "Recording narration and building slides…"
                : "Getting started…"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              A few minutes at most. It'll be here when you're back.
            </span>
          </p>
        </div>
        <div aria-hidden className="aspect-video w-full animate-pulse rounded-xl bg-secondary" />
      </Card>
    );
  }
  if (video?.status === "ready") {
    return (
      <div className="space-y-3">
        <video
          controls
          preload="metadata"
          className="aspect-video w-full rounded-2xl border bg-black"
          src={api.videoStreamUrl(video.id)}
        >
          <track
            kind="captions"
            src={api.videoCaptionsUrl(video.id)}
            srcLang="en"
            label="English"
            default
          />
        </video>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex flex-wrap gap-x-3 font-mono" data-numeric>
            {video.durationSeconds ? <span>{clock(video.durationSeconds)}</span> : null}
            <span>Made {relativeTime(video.updatedAt)}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => make.mutate()}>
            <RefreshCw /> Make a new one
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Card className="relative mx-auto max-w-lg items-center gap-4 overflow-hidden p-8 text-center sm:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0_0,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_60%)]"
      />
      <span className="relative grid size-14 place-items-center rounded-2xl bg-primary/14 text-primary">
        <Clapperboard className="size-7" aria-hidden />
      </span>
      <div className="relative space-y-1">
        <h2 className="text-xl font-bold">Watch it as a short video</h2>
        <p className="text-sm text-muted-foreground">
          A narrated slideshow of your notes, with captions.
        </p>
      </div>
      {video?.status === "failed" ? (
        <p role="alert" className="relative flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" aria-hidden />{" "}
          {video.error ?? "The last try didn't work."}
        </p>
      ) : null}
      <Button size="lg" className="relative" onClick={() => make.mutate()}>
        <Clapperboard /> {video?.status === "failed" ? "Try again" : "Make a video"}
      </Button>
    </Card>
  );
}
