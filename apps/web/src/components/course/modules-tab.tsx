import type { CourseModule, ModuleItem, ModuleItemKind } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";
import {
  ClipboardList,
  ExternalLink,
  FileText,
  Globe,
  Layers,
  type LucideIcon,
  MessagesSquare,
  NotebookText,
  PencilRuler,
  Wrench,
} from "lucide-react";
import { EmptyState } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/lib/time";
import { cn } from "@/lib/utils";

const kindMeta: Record<ModuleItemKind, { icon: LucideIcon; label: string }> = {
  file: { icon: FileText, label: "File" },
  page: { icon: NotebookText, label: "Page" },
  assignment: { icon: ClipboardList, label: "Assignment" },
  quiz: { icon: PencilRuler, label: "Quiz" },
  discussion: { icon: MessagesSquare, label: "Discussion" },
  external_url: { icon: Globe, label: "Link" },
  external_tool: { icon: Wrench, label: "Tool" },
  subheader: { icon: Layers, label: "Section" },
};

function Item({ item }: { item: ModuleItem }) {
  if (item.kind === "subheader") {
    return (
      <li
        className="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        style={{ paddingInlineStart: `${1 + item.indent * 1.25}rem` }}
      >
        {item.title}
      </li>
    );
  }
  const { icon: Icon, label } = kindMeta[item.kind];
  const href = item.externalUrl ?? item.htmlUrl;
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <Badge variant="outline" className="hidden sm:inline-flex">
        {label}
      </Badge>
      {href ? (
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );
  const cls = cn(
    "flex items-center gap-3 px-4 py-2.5 text-sm",
    href &&
      "outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
  );
  const style = { paddingInlineStart: `${1 + item.indent * 1.25}rem` };
  // Files and pages open in Talvra's reader; everything else opens in Canvas.
  if (item.documentId) {
    return (
      <li>
        <Link
          to="/documents/$documentId"
          params={{ documentId: item.documentId }}
          className={cn(
            cls,
            "outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
          )}
          style={style}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <Badge variant="outline" className="hidden sm:inline-flex">
            {label}
          </Badge>
        </Link>
      </li>
    );
  }
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={cls} style={style}>
          {body}
          <span className="sr-only">(opens in Canvas)</span>
        </a>
      ) : (
        <div className={cls} style={style}>
          {body}
        </div>
      )}
    </li>
  );
}

export function ModulesTab({ modules, moduleId }: { modules: CourseModule[]; moduleId?: string }) {
  const shown = moduleId ? modules.filter((m) => m.id === moduleId) : modules;
  if (!modules.length) {
    return (
      <EmptyState
        icon={Layers}
        title="No modules"
        description="This course doesn't use modules. Try Files."
      />
    );
  }
  return (
    <div className="space-y-4">
      {shown.map((m) => (
        <section
          key={m.id}
          aria-labelledby={`module-${m.id}`}
          className="overflow-hidden rounded-xl border bg-card"
        >
          <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
            <h3 id={`module-${m.id}`} className="font-medium">
              {m.name}
            </h3>
            <span className="text-xs text-muted-foreground">
              {plural(m.items.filter((i) => i.kind !== "subheader").length, "item")}
            </span>
          </header>
          {m.items.length ? (
            <ul className="divide-y">
              {m.items.map((i) => (
                <Item key={i.id} item={i} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">Nothing in this module yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
