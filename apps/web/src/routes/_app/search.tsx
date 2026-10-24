import type { AskSource, SearchHit, TitleMatch } from "@talvra/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  ClipboardList,
  FileText,
  LoaderCircle,
  MessageCircleQuestion,
  Search as SearchIcon,
  Sparkles,
  Square,
} from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { Eyebrow, IconTile, SectionLabel } from "@/components/blocks";
import { Markdown, slugify } from "@/components/document/markdown";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { anchorLabel, Highlighted } from "@/components/search/highlight";
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
      <PageHeader title="Search" description="Find it in your material, or ask a question." />
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
          className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Notes, slides, readings, assignments…"
          aria-label="Search your course material"
          className="h-12 rounded-xl bg-card pr-10 pl-11 text-base"
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
          description="Results link to the exact page or slide."
        />
      ) : results.isPending ? (
        <ListSkeleton rows={4} />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : data && !data.hits.length && !data.titles.length ? (
        <EmptyState
          icon={SearchIcon}
          title="No matches"
          description="Try other words, or ask it as a question."
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
              <SectionLabel id="hits-heading">In your material</SectionLabel>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
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
    <section aria-labelledby="titles-heading" className="space-y-3">
      <SectionLabel id="titles-heading">Jump to</SectionLabel>
      <ul className="flex flex-wrap gap-2">
        {titles.map((t) => {
          const Icon = icon[t.kind];
          const cls =
            "inline-flex max-w-full items-center gap-2 rounded-full border bg-card py-1.5 pr-3.5 pl-1.5 text-sm font-medium outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50";
          const label = (
            <>
              <IconTile icon={Icon} className="size-7 rounded-full [&_svg]:size-3.5" />
              <span className="truncate">{t.title}</span>
              {t.kind !== "course" && t.courseName ? (
                <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
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
        className="flex gap-3 p-4 outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <IconTile icon={FileText} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{hit.documentTitle}</span>
            <SourceTag>{anchorLabel(hit.anchor)}</SourceTag>
            {hit.courseName ? (
              <SourceTag title={hit.courseName}>{courseLabel(hit.courseName)}</SourceTag>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-soft">
            <Highlighted text={hit.snippet} />
          </p>
        </div>
      </Link>
    </li>
  );
}

/** Mono tag for where a passage is (page, slide, course). */
function SourceTag({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="rounded-[6px] border bg-background px-1.5 py-px font-mono text-[11px] text-soft"
    >
      {children}
    </span>
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {turns.length ? (
        <ol className="space-y-6" aria-label="Conversation">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <li
                key={t.id}
                className="ms-auto w-fit max-w-[85%] animate-rise rounded-2xl rounded-br-md border bg-secondary px-4 py-2.5 font-medium"
              >
                {t.content}
              </li>
            ) : (
              <li
                key={t.id}
                className="animate-rise space-y-3"
                aria-busy={busy && i === turns.length - 1}
              >
                <Eyebrow className="flex items-center gap-2 text-primary">
                  <Sparkles className="size-3.5" aria-hidden /> Talvra
                </Eyebrow>
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
          description="Answers cite your synced files and pages."
        />
      )}
      <div ref={endRef} />
      <form
        className="sticky bottom-20 rounded-2xl border bg-card p-2 shadow-lg shadow-black/10 md:bottom-4"
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
          className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            Shift+Enter for a new line
          </span>
          <span className="sm:hidden" />
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
      className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-primary/30 bg-primary/12 px-1 align-text-top font-mono text-[11px] font-medium text-primary no-underline outline-none transition-colors duration-150 hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {n}
    </Link>
  );
}

function Sources({ sources }: { sources: AskSource[] }) {
  return (
    <details className="group rounded-xl border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase [&::-webkit-details-marker]:hidden">
        Sources ({sources.length})
        <ChevronDown
          className="size-4 transition-transform duration-150 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol className="grid gap-0.5 border-t p-1.5">
        {sources.map((s) => (
          <li key={s.n}>
            <Link
              to="/documents/$documentId"
              params={{ documentId: s.documentId }}
              search={{ tab: "read" }}
              hash={slugify(s.heading)}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/12 font-mono text-[11px] text-primary tabular-nums">
                {s.n}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.documentTitle}</span>
              <SourceTag>{anchorLabel(s.anchor)}</SourceTag>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}
