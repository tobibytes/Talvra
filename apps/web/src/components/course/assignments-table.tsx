import type { Assignment } from "@talvra/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import * as React from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { ClipboardList, ExternalLink } from "@/components/icons";
import { EmptyState } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { useDataTable } from "@/hooks/use-data-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { dateTime, relativeTime } from "@/lib/time";

const SUBMISSION: Record<string, string> = {
  online_upload: "File upload",
  online_text_entry: "Text entry",
  online_url: "Website URL",
  online_quiz: "Quiz",
  discussion_topic: "Discussion",
  on_paper: "On paper",
  external_tool: "External tool",
  none: "No submission",
  media_recording: "Media",
};

export function dueState(dueAt: string | null, now = Date.now()) {
  if (!dueAt) return "none" as const;
  const t = new Date(dueAt).getTime();
  if (t < now) return "past" as const;
  if (t - now < 48 * 3600_000) return "soon" as const;
  return "later" as const;
}

const PAST = 4e15;
export function dueRank(dueAt: string | null, now = Date.now()) {
  if (!dueAt) return PAST - 1;
  const t = new Date(dueAt).getTime();
  return t >= now ? t : PAST + (now - t);
}

export function AssignmentsTable({ assignments }: { assignments: Assignment[] }) {
  const columns = React.useMemo<ColumnDef<DataTableFeatures, Assignment>[]>(
    () => [
      {
        id: "asgName",
        size: 340,
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Assignment" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {row.original.htmlUrl ? (
              <a
                href={row.original.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 font-medium underline-offset-4 hover:underline"
              >
                <span className="truncate">{row.original.name}</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">(opens in Canvas)</span>
              </a>
            ) : (
              <span className="truncate font-medium">{row.original.name}</span>
            )}
          </div>
        ),
        meta: { label: "Assignment", placeholder: "Search assignments…", variant: "text" },
        enableColumnFilter: true,
      },
      {
        id: "asgDue",
        size: 200,
        // What students need first: upcoming (soonest first), then undated,
        // then past due (most recent first).
        accessorFn: (a) => dueRank(a.dueAt),
        header: ({ column }) => <DataTableColumnHeader column={column} label="Due" />,
        cell: ({ row }) => {
          const { dueAt } = row.original;
          const state = dueState(dueAt);
          if (!dueAt) return <span className="text-muted-foreground">No due date</span>;
          return (
            <div className="flex flex-col">
              <span className={state === "past" ? "text-muted-foreground" : ""}>
                {dateTime(dueAt)}
              </span>
              {state === "soon" ? (
                <Badge variant="warning" className="mt-0.5 w-fit">
                  Due {relativeTime(dueAt)}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {state === "past"
                    ? `Was due ${relativeTime(dueAt)}`
                    : `Due ${relativeTime(dueAt)}`}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "asgPoints",
        size: 90,
        accessorKey: "pointsPossible",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Points" />,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.pointsPossible ?? "—"}</span>
        ),
      },
      {
        id: "asgSubmit",
        size: 200,
        accessorFn: (a) => a.submissionTypes.map((t) => SUBMISSION[t] ?? t).join(", "),
        header: () => "Submit as",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.submissionTypes.map((t) => (
              <Badge key={t} variant="outline">
                {SUBMISSION[t] ?? t}
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [],
  );
  const { table } = useDataTable({
    data: assignments,
    columns,
    mode: "client",
    getRowId: (r) => r.id,
    queryKeys: { page: "apage", perPage: "aper", sort: "asort", joinOperator: "ajoin" },
    initialState: {
      sorting: [{ id: "asgDue", desc: false }],
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });
  if (!assignments.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No assignments"
        description="Nothing to show for this course or module."
      />
    );
  }
  return (
    <DataTable table={table} aria-label="Assignments">
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
