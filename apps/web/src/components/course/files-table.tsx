import type { CourseDocument } from "@talvra/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText, FolderOpen, NotebookText } from "lucide-react";
import * as React from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { EmptyState } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { useDataTable } from "@/hooks/use-data-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { dateTime, fileSize, relativeTime } from "@/lib/time";

/** "application/pdf" → "PDF". Readable types instead of MIME strings. */
export function kindOf(d: Pick<CourseDocument, "mimeType" | "source" | "title">) {
  if (d.source === "canvas_page") return "Page";
  const ext = d.title.split(".").pop()?.toLowerCase();
  const m = d.mimeType ?? "";
  if (m.includes("pdf") || ext === "pdf") return "PDF";
  if (m.includes("presentation") || ext === "pptx" || ext === "ppt") return "Slides";
  if (m.includes("wordprocessing") || m.includes("msword") || ext === "docx" || ext === "doc")
    return "Document";
  if (m.includes("spreadsheet") || ext === "xlsx" || ext === "csv") return "Spreadsheet";
  if (m.startsWith("image/")) return "Image";
  if (m.startsWith("video/")) return "Video";
  if (m.startsWith("audio/")) return "Audio";
  if (m.startsWith("text/")) return "Text";
  return "Other";
}

const statusLabel: Record<CourseDocument["status"], string> = {
  pending: "Not processed",
  downloading: "Processing",
  extracting: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function FilesTable({ documents }: { documents: CourseDocument[] }) {
  const kinds = React.useMemo(
    () => [...new Set(documents.map(kindOf))].sort().map((k) => ({ label: k, value: k })),
    [documents],
  );
  const columns = React.useMemo<ColumnDef<DataTableFeatures, CourseDocument>[]>(
    () => [
      {
        id: "fileTitle",
        size: 340,
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
        cell: ({ row }) => {
          const Icon = row.original.source === "canvas_page" ? NotebookText : FileText;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-medium">{row.original.title}</span>
            </div>
          );
        },
        meta: { label: "Name", placeholder: "Search files…", variant: "text" },
        enableColumnFilter: true,
      },
      {
        id: "fileKind",
        size: 110,
        accessorFn: (d) => kindOf(d),
        header: ({ column }) => <DataTableColumnHeader column={column} label="Type" />,
        cell: ({ getValue }) => <Badge variant="secondary">{String(getValue())}</Badge>,
        meta: { label: "Type", variant: "multiSelect", options: kinds },
        enableColumnFilter: true,
        filterFn: (row, id, value: string[]) =>
          !value?.length || value.includes(String(row.getValue(id))),
      },
      {
        id: "fileSize",
        size: 90,
        accessorKey: "sizeBytes",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Size" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {fileSize(row.original.sizeBytes)}
          </span>
        ),
      },
      {
        id: "fileFolder",
        size: 150,
        accessorKey: "folderPath",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Folder" />,
        cell: ({ row }) =>
          row.original.folderPath ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="size-3.5" aria-hidden />
              {row.original.folderPath.replace(/^course files\/?/, "") || "Course files"}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "fileStatus",
        size: 140,
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Study aids" />,
        cell: ({ row }) => (
          <Badge variant={row.original.status === "ready" ? "success" : "outline"}>
            {statusLabel[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "fileUpdated",
        size: 120,
        accessorKey: "updatedAt",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Updated" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground" title={dateTime(row.original.updatedAt)}>
            {relativeTime(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    [kinds],
  );
  const { table } = useDataTable({
    data: documents,
    columns,
    mode: "client",
    getRowId: (r) => r.id,
    queryKeys: { page: "fpage", perPage: "fper", sort: "fsort", joinOperator: "fjoin" },
    initialState: {
      sorting: [{ id: "fileTitle", desc: false }],
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });
  if (!documents.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No files"
        description="Nothing to show for this course or module yet. Files appear after a sync."
      />
    );
  }
  return (
    <DataTable table={table} aria-label="Course files">
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
