import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { StatusPill } from "@/components/blocks";
import { AssignmentsTable } from "@/components/course/assignments-table";
import { FilesTable } from "@/components/course/files-table";
import { ModulesTab } from "@/components/course/modules-tab";
import { UploadButton } from "@/components/document/upload-dialog";
import { ExternalLink, GraduationCap, SearchX } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { SyncNowButton } from "@/components/sync/sync-status-card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiRequestError, api } from "@/lib/api";
import { meQuery } from "@/lib/auth";
import { courseLabel } from "@/lib/course-label";
import { dateTime, relativeTime } from "@/lib/time";

const tabs = ["modules", "files", "assignments", "study"] as const;
type Tab = (typeof tabs)[number];

const Search = z.object({
  tab: z.enum(tabs).optional().catch(undefined),
  module: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/courses/$courseId")({
  validateSearch: Search,
  component: CoursePage,
});

const ALL = "__all";

function CoursePage() {
  const { courseId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab ?? "modules";
  const moduleId = search.module;

  const me = useQuery(meQuery);
  const course = useQuery({ queryKey: ["course", courseId], queryFn: () => api.course(courseId) });
  const modules = useQuery({
    queryKey: ["course", courseId, "modules"],
    queryFn: () => api.courseModules(courseId),
  });
  const documents = useQuery({
    queryKey: ["course", courseId, "documents"],
    queryFn: () => api.courseDocuments(courseId),
    enabled: tab === "files",
  });
  const assignments = useQuery({
    queryKey: ["course", courseId, "assignments"],
    queryFn: () => api.courseAssignments(courseId),
    enabled: tab === "assignments",
  });

  if (course.isError && course.error instanceof ApiRequestError && course.error.status === 404) {
    return (
      <EmptyState
        icon={SearchX}
        title="Course not found"
        description="It may have been removed from your courses."
        action={<Button render={<Link to="/courses" />}>All courses</Button>}
      />
    );
  }

  const c = course.data;
  const canvasUrl = c && me.data?.canvas ? `${me.data.canvas.baseUrl}/courses/${c.canvasId}` : null;
  const moduleName = modules.data?.items.find((m) => m.id === moduleId)?.name;
  const setSearch = (patch: Partial<z.infer<typeof Search>>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const filteredDocs = (documents.data?.items ?? []).filter(
    (d) => !moduleId || d.moduleId === moduleId,
  );
  const filteredAssignments = (assignments.data?.items ?? []).filter(
    (a) => !moduleId || a.moduleIds.includes(moduleId),
  );

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/courses" />}>Courses</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{c ? courseLabel(c.courseCode, c.name) : "Course"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {course.isPending ? (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : course.isError ? (
        <div className="mb-6">
          <ErrorState error={course.error} onRetry={() => course.refetch()} />
        </div>
      ) : c ? (
        <PageHeader
          eyebrow={c.term && !c.name.includes(c.term) ? c.term : "Course"}
          title={courseLabel(c.courseCode, c.name)}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>{c.name}</span>
              {c.lastSyncedAt ? (
                <span title={dateTime(c.lastSyncedAt)}>
                  <StatusPill tone="ok">Synced {relativeTime(c.lastSyncedAt)}</StatusPill>
                </span>
              ) : (
                <StatusPill>Not synced</StatusPill>
              )}
            </span>
          }
          actions={
            <>
              {canvasUrl ? (
                <Button
                  variant="ghost"
                  render={<a href={canvasUrl} target="_blank" rel="noreferrer" />}
                >
                  <ExternalLink /> Canvas
                </Button>
              ) : null}
              <UploadButton courseId={courseId} />
              <SyncNowButton courseId={courseId} label="Sync course" />
            </>
          }
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setSearch({ tab: v as Tab })}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="modules">
              Modules{c ? <Count n={c.counts.modules} /> : null}
            </TabsTrigger>
            <TabsTrigger value="files">
              Files{c ? <Count n={c.counts.files + c.counts.pages} /> : null}
            </TabsTrigger>
            <TabsTrigger value="assignments">
              Assignments{c ? <Count n={c.counts.assignments} /> : null}
            </TabsTrigger>
            <TabsTrigger value="study">Study</TabsTrigger>
          </TabsList>
          {tab !== "study" && (modules.data?.items.length ?? 0) > 0 ? (
            <Select
              value={moduleId ?? ALL}
              onValueChange={(v) => setSearch({ module: v === ALL || !v ? undefined : String(v) })}
              items={[
                { value: ALL, label: "All modules" },
                ...(modules.data?.items ?? []).map((m) => ({ value: m.id, label: m.name })),
              ]}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Filter by module">
                <SelectValue>{moduleName ?? "All modules"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All modules</SelectItem>
                {modules.data?.items.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <TabsContent value="modules">
          {modules.isPending ? (
            <ListSkeleton rows={4} />
          ) : modules.isError ? (
            <ErrorState error={modules.error} onRetry={() => modules.refetch()} />
          ) : (
            <ModulesTab modules={modules.data.items} moduleId={moduleId} />
          )}
        </TabsContent>
        <TabsContent value="files">
          {documents.isPending ? (
            <ListSkeleton rows={5} />
          ) : documents.isError ? (
            <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
          ) : (
            <FilesTable documents={filteredDocs} />
          )}
        </TabsContent>
        <TabsContent value="assignments">
          {assignments.isPending ? (
            <ListSkeleton rows={5} />
          ) : assignments.isError ? (
            <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
          ) : (
            <AssignmentsTable assignments={filteredAssignments} />
          )}
        </TabsContent>
        <TabsContent value="study">
          <CourseStudy courseId={courseId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Course "Study" tab: review this course's due cards; aids are made per document. */
function CourseStudy({ courseId }: { courseId: string }) {
  const due = useQuery({
    queryKey: ["study", "due", { courseId }],
    queryFn: () => api.dueCards({ courseId, limit: 100 }),
  });
  const n = due.data?.items.length ?? 0;
  return (
    <div className="space-y-4">
      {n ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <p className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold text-primary" data-numeric>
              {n}
            </span>
            <span className="text-sm text-muted-foreground">
              {n === 1 ? "card" : "cards"} due from this course
            </span>
          </p>
          <Button render={<Link to="/review" search={{ courseId }} />}>Review now</Button>
        </div>
      ) : null}
      <EmptyState
        icon={GraduationCap}
        title="Study any file in this course"
        description="Open a file, then make notes, flashcards or a quiz."
        action={
          <Button
            variant="outline"
            render={
              <Link
                to="/courses/$courseId"
                params={{ courseId }}
                search={(prev) => ({ ...prev, tab: "files" })}
                replace
              />
            }
          >
            Browse files
          </Button>
        }
      />
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">{n}</span>;
}
