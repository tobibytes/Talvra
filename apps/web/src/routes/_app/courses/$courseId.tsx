import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, GraduationCap, SearchX } from "lucide-react";
import { z } from "zod";
import { AssignmentsTable } from "@/components/course/assignments-table";
import { FilesTable } from "@/components/course/files-table";
import { ModulesTab } from "@/components/course/modules-tab";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { SyncNowButton } from "@/components/sync/sync-status-card";
import { Badge } from "@/components/ui/badge";
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
            <BreadcrumbPage>{c?.courseCode ?? c?.name ?? "Course"}</BreadcrumbPage>
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
          title={c.name}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {c.courseCode ? <Badge variant="secondary">{c.courseCode}</Badge> : null}
              {c.term ? <span>{c.term}</span> : null}
              <span aria-hidden>·</span>
              {c.lastSyncedAt ? (
                <span title={dateTime(c.lastSyncedAt)}>Synced {relativeTime(c.lastSyncedAt)}</span>
              ) : (
                <span>Not synced yet</span>
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
          <EmptyState
            icon={GraduationCap}
            title="Study tools are on the way"
            description="Notes, flashcards and quizzes made from this course's material will live here."
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">{n}</span>;
}
