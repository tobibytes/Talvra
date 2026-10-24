import type { AskSource, SearchHit, TitleMatch } from "@talvra/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUp,
  BookOpen,
  ClipboardList,
  FileText,
  LoaderCircle,
  MessageCircleQuestion,
  Search as SearchIcon,
  Square,
} from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { Markdown, slugify } from "@/components/document/markdown";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { anchorLabel, Highlighted } from "@/components/search/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiRequestError, api } from "@/lib/api";
import { courseLabel } from "@/lib/course-label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/search")({
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    course: z.string().optional().catch(undefined),
    mode: z.enum(["search", "ask"]).optional().catch(undefined),
  }),
  component: SearchPage,
});

const ALL = "__all";

function SearchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode = search.mode ?? "search";
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api.courses({ limit: 100 }) });
  const selected = (courses.data?.items ?? []).filter((c) => c.selected);
  const set = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageHeader
        title="Search"
        description="Find anything in your course material, or ask a question and get an answer with sources."
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={mode} onValueChange={(v) => set({ mode: v as "search" | "ask" })}>
          <TabsList>
            <TabsTrigger value="search">
              <SearchIcon /> Search
            </TabsTrigger>
            <TabsTrigger value="ask">
              <MessageCircleQuestion /> Ask
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {selected.length ? (
          <Select
            value={search.course ?? ALL}
            onValueChange={(v) => set({ course: !v || v === ALL ? undefined : String(v) })}
            items={[
              { value: ALL, label: "All courses" },
              ...selected.map((c) => ({ value: c.id, label: c.name })),
            ]}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Limit to a course">
              <SelectValue>
                {selected.find((c) => c.id === search.course)?.name ?? "All courses"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All courses</SelectItem>
              {selected.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {courseLabel(c.courseCode, c.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {mode === "search" ? (
        <SearchMode
          q={search.q ?? ""}
          courseId={search.course}
          onQuery={(q) => set({ q: q || undefined })}
          onAsk={(q) => set({ mode: "ask", q })}
        />
      ) : (
        <AskMode courseId={search.course} initial={search.q} />
      )}
    </>
  );
}

function SearchMode({
  q,
  courseId,
  onQuery,
  onAsk,
}: {
  q: string;
  courseId?: string;
  onQuery: (q: string) => void;
  onAsk: (q: string) => void;
}) {
  const [value, setValue] = React.useState(q);
  const debounced = useDebouncedValue(value.trim(), 250);
  React.useEffect(() => {
    if (debounced !== q) onQuery(debounced);
  }, [debounced, q, onQuery]);
  const results = useQuery({
    queryKey: ["search", debounced, courseId],
    queryFn: () => api.search({ q: debounced, courseId }),
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
  });
  const data = results.data;

  return (
    <div className="space-y-5">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search notes, slides, readings and assignments…"
          aria-label="Search your course material"
          className="h-11 pl-9 text-base"
        />
        {results.isFetching ? (
          <LoaderCircle
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {!debounced ? (
        <EmptyState
          icon={SearchIcon}
          title="Search everything you've synced"
          description="Words are matched as you type, and similar ideas are found too. Results link to the exact page or slide."
        />
      ) : results.isPending ? (
        <ListSkeleton rows={4} />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : data && !data.hits.length && !data.titles.length ? (
        <EmptyState
          icon={SearchIcon}
          title="No matches"
          description="Try fewer or different words, or ask it as a question."
          action={
            <Button variant="outline" onClick={() => onAsk(debounced)}>
              <MessageCircleQuestion /> Ask instead
            </Button>
          }
        />
      ) : data ? (
        <div className="space-y-6" aria-live="polite">
          {data.titles.length ? <TitleMatches titles={data.titles} /> : null}
          {data.hits.length ? (
            <section aria-labelledby="hits-heading" className="space-y-3">
              <h2 id="hits-heading" className="text-sm font-medium text-muted-foreground">
                In your material
              </h2>
              <ul className="space-y-3">
                {data.hits.map((h) => (
                  <HitRow key={h.chunkId} hit={h} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TitleMatches({ titles }: { titles: TitleMatch[] }) {
  const icon = { course: BookOpen, document: FileText, assignment: ClipboardList } as const;
  return (
    <section aria-labelledby="titles-heading" className="space-y-2">
      <h2 id="titles-heading" className="text-sm font-medium text-muted-foreground">
        Jump to
      </h2>
      <ul className="flex flex-wrap gap-2">
        {titles.map((t) => {
          const Icon = icon[t.kind];
          const cls =
            "inline-flex max-w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50";
          const label = (
            <>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{t.title}</span>
              {t.kind !== "course" && t.courseName ? (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {courseLabel(t.courseName)}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={`${t.kind}-${t.id}`} className="max-w-full">
              {t.kind === "document" ? (
                <Link to="/documents/$documentId" params={{ documentId: t.id }} className={cls}>
                  {label}
                </Link>
              ) : t.kind === "course" ? (
                <Link to="/courses/$courseId" params={{ courseId: t.id }} className={cls}>
                  {label}
                </Link>
              ) : (
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: t.courseId ?? "" }}
                  search={{ tab: "assignments" }}
                  className={cls}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <li>
      <Link
        to="/documents/$documentId"
        params={{ documentId: hit.documentId }}
        search={{ tab: "read" }}
        hash={slugify(hit.heading)}
        className="block space-y-1.5 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{hit.documentTitle}</span>
          <Badge variant="outline">{anchorLabel(hit.anchor)}</Badge>
          {hit.courseName ? (
            <span className="text-xs text-muted-foreground" title={hit.courseName}>
              {courseLabel(hit.courseName)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          <Highlighted text={hit.snippet} />
        </p>
      </Link>
    </li>
  );
}

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  error?: string;
};

function AskMode({ courseId, initial }: { courseId?: string; initial?: string }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState(initial ?? "");
  const [busy, setBusy] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    const history = turns
      .filter((t) => !t.error)
      .map(({ role, content }) => ({ role, content }))
      .slice(-10);
    setTurns((t) => [
      ...t,
      { id: crypto.randomUUID(), role: "user", content: question },
      { id: crypto.randomUUID(), role: "assistant", content: "" },
    ]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const patchLast = (fn: (t: Turn) => Turn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1] as Turn)]);
    try {
      await api.ask(
        { question, courseId, history },
        (e) => {
          if (e.type === "sources") patchLast((t) => ({ ...t, sources: e.sources }));
          if (e.type === "delta") patchLast((t) => ({ ...t, content: t.content + e.text }));
          if (e.type === "error") patchLast((t) => ({ ...t, error: e.message }));
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patchLast((t) => ({
          ...t,
          error: err instanceof ApiRequestError ? err.message : "Couldn't reach Talvra. Try again.",
        }));
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length ? (
        <ol className="space-y-4" aria-label="Conversation">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <li
                key={t.id}
                className="ms-auto w-fit max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground"
              >
                {t.content}
              </li>
            ) : (
              <li
                key={t.id}
                className="space-y-3 rounded-2xl border bg-card px-4 py-3"
                aria-busy={busy && i === turns.length - 1}
              >
                {t.content ? (
                  <Markdown renderCite={(n) => <SourceChip n={n} sources={t.sources ?? []} />}>
                    {t.content}
                  </Markdown>
                ) : !t.error ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    {t.sources ? "Writing an answer…" : "Looking through your material…"}
                  </p>
                ) : null}
                {t.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t.error}
                  </p>
                ) : null}
                {t.sources?.length && t.content ? <Sources sources={t.sources} /> : null}
              </li>
            ),
          )}
        </ol>
      ) : (
        <EmptyState
          icon={MessageCircleQuestion}
          title="Ask about your material"
          description="Answers come from your synced files and pages, with numbered sources. Talvra helps you understand; it won't do graded work for you."
        />
      )}
      <div ref={endRef} />
      <form
        className="sticky bottom-20 rounded-2xl border bg-background p-2 shadow-sm md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <Textarea
          id="ask-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="e.g. Why is array indexing constant time?"
          className="resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => abort.current?.abort()}
            >
              <Square /> Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              <ArrowUp /> Ask
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function SourceChip({ n, sources }: { n: number; sources: AskSource[] }) {
  const s = sources.find((x) => x.n === n);
  if (!s) return <span className="text-xs text-muted-foreground">[{n}]</span>;
  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: s.documentId }}
      search={{ tab: "read" }}
      hash={slugify(s.heading)}
      aria-label={`Source ${n}: ${s.documentTitle}, ${anchorLabel(s.anchor)}`}
      className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md border bg-muted px-1 align-text-top text-[11px] font-medium no-underline outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {n}
    </Link>
  );
}

function Sources({ sources }: { sources: AskSource[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Sources ({sources.length})</summary>
      <ol className="mt-2 space-y-1">
        {sources.map((s) => (
          <li key={s.n} className={cn("flex gap-2")}>
            <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{s.n}.</span>
            <Link
              to="/documents/$documentId"
              params={{ documentId: s.documentId }}
              search={{ tab: "read" }}
              hash={slugify(s.heading)}
              className="min-w-0 underline-offset-4 hover:underline"
            >
              {s.documentTitle} · {anchorLabel(s.anchor)}
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}
