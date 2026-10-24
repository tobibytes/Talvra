import type { Anchor, DocSection, DocumentDetail } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { kindOf } from "@/components/course/files-table";
import { Markdown, slugify } from "@/components/document/markdown";
import { DocumentStatusBadge, isProcessing } from "@/components/document/status";
import {
  BookOpen,
  CircleAlert,
  Clapperboard,
  Download,
  ExternalLink,
  FileQuestion,
  FileText,
  Layers,
  ListChecks,
  LoaderCircle,
  NotebookText,
  RefreshCw,
  ScanText,
  SearchX,
  Trash2,
} from "@/components/icons";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { AidPanel } from "@/components/study/aid-panel";
import { DeckView } from "@/components/study/deck-view";
import { NotesView } from "@/components/study/notes-view";
import { QuizRunner } from "@/components/study/quiz-runner";
import { segmentedList, segmentedTrigger } from "@/components/study/segmented";
import { VideoPanel } from "@/components/study/video-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiRequestError, api } from "@/lib/api";
import { courseLabel } from "@/lib/course-label";
import { fileSize, plural } from "@/lib/time";
import { cn } from "@/lib/utils";

const tabs = ["read", "notes", "flashcards", "quiz", "video"] as const;
type Tab = (typeof tabs)[number];

export const Route = createFileRoute("/_app/documents/$documentId")({
  validateSearch: z.object({ tab: z.enum(tabs).optional().catch(undefined) }),
  component: DocumentPage,
});

const anchorKey = (a: Anchor) => `${a.kind}:${a.n}`;

function DocumentPage() {
  const { documentId } = Route.useParams();
  const doc = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.document(documentId),
    // Live updates arrive over the socket; this is the fallback while processing.
    refetchInterval: (q) => (q.state.data && isProcessing(q.state.data.status) ? 5000 : false),
  });
  const ready = doc.data?.status === "ready";
  const content = useQuery({
    queryKey: ["document", documentId, "content"],
    queryFn: () => api.documentContent(documentId),
    enabled: ready,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (doc.isError && doc.error instanceof ApiRequestError && doc.error.status === 404) {
    return (
      <EmptyState
        icon={SearchX}
        title="Document not found"
        description="It may have been removed from Canvas or deleted."
        action={<Button render={<Link to="/courses" />}>Your courses</Button>}
      />
    );
  }
  if (doc.isPending) return <HeaderSkeleton />;
  if (doc.isError) return <ErrorState error={doc.error} onRetry={() => doc.refetch()} />;
  const d = doc.data;

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/courses" />}>Courses</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {d.courseId && d.courseName ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink
                  render={
                    <Link
                      to="/courses/$courseId"
                      params={{ courseId: d.courseId }}
                      search={{ tab: "files" }}
                    />
                  }
                >
                  {courseLabel(d.courseName)}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          ) : null}
          <BreadcrumbItem>
            <BreadcrumbPage className="max-w-[40ch] truncate">{d.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        eyebrow={d.source === "upload" ? "Your upload" : kindOf(d)}
        title={d.title}
        description={<Meta doc={d} />}
        actions={<Actions doc={d} />}
      />

      {d.warnings.includes("little_text") && ready ? (
        <Alert className="mb-6">
          <ScanText />
          <AlertTitle>This looks like a scan</AlertTitle>
          <AlertDescription>
            Little text could be read, so notes and search may miss things.
          </AlertDescription>
        </Alert>
      ) : null}

      {isProcessing(d.status) ? (
        <Processing doc={d} />
      ) : d.status === "failed" ? (
        <Failed doc={d} />
      ) : d.status === "unsupported" ? (
        <EmptyState
          icon={FileQuestion}
          title="Talvra can't read this file"
          description={d.error ?? "This type of file isn't supported yet."}
          action={<OpenOriginal doc={d} />}
        />
      ) : content.isPending ? (
        <ReaderSkeleton />
      ) : content.isError ? (
        <ErrorState error={content.error} onRetry={() => content.refetch()} />
      ) : (
        <Study doc={d} markdown={content.data.markdown} sections={content.data.sections} />
      )}
    </>
  );
}

/** Ready documents: read it, or study it (notes, flashcards, quiz). */
function Study({
  doc,
  markdown,
  sections,
}: {
  doc: DocumentDetail;
  markdown: string;
  sections: DocSection[];
}) {
  const { tab = "read" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const aids = useQuery({
    queryKey: ["document", doc.id, "aids"],
    queryFn: () => api.documentAids(doc.id),
    // Live updates come over the socket; poll as a fallback while something is cooking.
    refetchInterval: (q) =>
      Object.values(q.state.data ?? {}).some(
        (s) => s.latest?.status === "queued" || s.latest?.status === "generating",
      )
        ? 4000
        : false,
  });
  // Citation -> heading id in the reader (headings are slugged the same way).
  const slugs = React.useMemo(
    () => new Map(sections.map((s) => [anchorKey(s.anchor), slugify(s.heading)])),
    [sections],
  );
  const slugFor = React.useCallback((a: Anchor) => slugs.get(anchorKey(a)) ?? null, [slugs]);

  return (
    <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as Tab }, replace: true })}>
      <TabsList className={cn("mb-5", segmentedList)}>
        {(
          [
            ["read", "Read", BookOpen],
            ["notes", "Notes", NotebookText],
            ["flashcards", "Flashcards", Layers],
            ["quiz", "Quiz", ListChecks],
            ["video", "Video", Clapperboard],
          ] as const
        ).map(([value, label, Icon]) => (
          <TabsTrigger key={value} value={value} className={segmentedTrigger}>
            <Icon aria-hidden />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="read" className="animate-rise">
        <Reader markdown={markdown} sections={sections} />
      </TabsContent>
      <TabsContent value="video" className="animate-rise">
        <VideoPanel documentId={doc.id} />
      </TabsContent>
      {(["notes", "flashcards", "quiz"] as const).map((kind) => (
        <TabsContent key={kind} value={kind} className="animate-rise">
          {aids.isPending ? (
            <ReaderSkeleton />
          ) : aids.isError ? (
            <ErrorState error={aids.error} onRetry={() => aids.refetch()} />
          ) : (
            <AidPanel documentId={doc.id} kind={kind} slot={aids.data[kind]}>
              {(aid) =>
                aid.kind === "notes" && aid.content ? (
                  <NotesView notes={aid.content} documentId={doc.id} slugFor={slugFor} />
                ) : aid.kind === "flashcards" && aid.content ? (
                  <DeckView deck={aid.content} documentId={doc.id} slugFor={slugFor} />
                ) : aid.kind === "quiz" && aid.content ? (
                  <QuizRunner quiz={aid.content} documentId={doc.id} slugFor={slugFor} />
                ) : null
              }
            </AidPanel>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function Meta({ doc }: { doc: DocumentDetail }) {
  const parts = [
    doc.sizeBytes ? fileSize(doc.sizeBytes) : null,
    doc.pageCount ? plural(doc.pageCount, kindOf(doc) === "Slides" ? "slide" : "page") : null,
  ].filter(Boolean);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <DocumentStatusBadge status={doc.status} />
      {parts.map((p) => (
        <span key={p} data-numeric>
          {p}
        </span>
      ))}
    </span>
  );
}

function OpenOriginal({ doc }: { doc: DocumentDetail }) {
  if (doc.hasOriginal) {
    return (
      <Button variant="outline" render={<a href={api.originalUrl(doc.id)} download />}>
        <Download /> Original
      </Button>
    );
  }
  if (doc.canvasHtmlUrl) {
    return (
      <Button
        variant="outline"
        render={<a href={doc.canvasHtmlUrl} target="_blank" rel="noreferrer" />}
      >
        <ExternalLink /> Open in Canvas
      </Button>
    );
  }
  return null;
}

function Actions({ doc }: { doc: DocumentDetail }) {
  const [confirm, setConfirm] = React.useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteDocument(doc.id),
    onSuccess: async () => {
      setConfirm(false);
      toast(`Deleted ${doc.title}`);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      await navigate({ to: "/courses" });
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <>
      {doc.canvasHtmlUrl ? (
        <Button
          variant="ghost"
          render={<a href={doc.canvasHtmlUrl} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink /> Canvas
        </Button>
      ) : null}
      {doc.hasOriginal ? (
        <Button variant="outline" render={<a href={api.originalUrl(doc.id)} download />}>
          <Download /> Original
        </Button>
      ) : null}
      {doc.source === "upload" ? (
        <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
          <Trash2 /> Delete
        </Button>
      ) : null}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this upload?</DialogTitle>
            <DialogDescription>
              {doc.title} and everything made from it are deleted for good.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? <LoaderCircle className="animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const steps = [
  { key: "pending", label: "Queued" },
  { key: "downloading", label: "Getting the file" },
  { key: "extracting", label: "Reading it" },
  { key: "ready", label: "Ready to study" },
] as const;

function Processing({ doc }: { doc: DocumentDetail }) {
  const current = steps.findIndex((s) => s.key === doc.status);
  return (
    <Card className="mx-auto max-w-lg animate-rise gap-5 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">Getting this ready</h2>
        <p className="text-sm text-muted-foreground">
          Usually under a minute. This page updates on its own.
        </p>
      </div>
      <ol className="relative space-y-4" aria-live="polite">
        <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px bg-border" />
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border bg-card font-mono text-[11px]",
                i < current && "border-success/40 bg-success/12 text-success",
                i === current && "border-primary/40 bg-primary/14 text-primary",
              )}
            >
              {i === current ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(i > current && "text-muted-foreground", i === current && "font-medium")}
            >
              {s.label}
              {i < current ? <span className="sr-only"> (done)</span> : null}
              {i === current ? <span className="sr-only"> (in progress)</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Failed({ doc }: { doc: DocumentDetail }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.retryDocument(doc.id),
    onSuccess: (d) => queryClient.setQueryData(["document", doc.id], d),
    onError: (err) => toast.error(err.message),
  });
  return (
    <Alert variant="destructive" className="mx-auto max-w-lg">
      <CircleAlert />
      <AlertTitle>Couldn't read this file</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{doc.error ?? "Something went wrong while processing it."}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Try again
          </Button>
          <OpenOriginal doc={doc} />
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** Rendered Markdown with a sticky outline (pages/slides/headings) on wide screens. */
function Reader({ markdown, sections }: { markdown: string; sections: DocSection[] }) {
  // Citations link here with #page-3 etc.; scroll once the text has rendered.
  const { hash } = useLocation();
  React.useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash]);
  const outline = sections.filter((s) => s.level <= 3).slice(0, 200);
  if (!markdown.trim()) {
    return (
      <EmptyState
        icon={FileText}
        title="No text found"
        description="This file didn't contain any readable text."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <article
        className="min-w-0 rounded-2xl border bg-card px-5 py-4 sm:px-10 sm:py-6 lg:order-1"
        aria-label="Document text"
      >
        {/* A comfortable reading measure. */}
        <Markdown className="mx-auto max-w-[68ch]">{markdown}</Markdown>
      </article>
      {outline.length > 1 ? (
        <nav aria-label="Outline" className="hidden lg:order-2 lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] space-y-0.5 overflow-y-auto border-l ps-3 text-sm">
            <p className="mb-2 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
              Outline
            </p>
            {outline.map((s, i) => (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: headings can repeat
                key={i}
                href={`#${slugify(s.heading)}`}
                className={cn(
                  "block truncate rounded-lg px-2 py-1 text-muted-foreground outline-none transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  s.level >= 3 && "ps-5",
                )}
              >
                {s.heading}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <ReaderSkeleton />
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div
      className="space-y-3 rounded-2xl border bg-card p-8"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder lines
        <Skeleton key={i} className={cn("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
