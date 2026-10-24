import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, MessageCircleQuestion } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { slugify } from "@/components/document/markdown";
import { anchorLabel } from "@/components/search/highlight";
import { themes } from "@/components/theme";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { allNav } from "@/lib/nav";

type PaletteContext = { open: boolean; setOpen: (open: boolean) => void };
const Ctx = React.createContext<PaletteContext | null>(null);

export function useCommandPalette() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

/** Owns the open state and the global ⌘K / Ctrl+K shortcut. */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = React.useMemo(() => ({ open, setOpen }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette open={open} setOpen={setOpen} />
    </Ctx.Provider>
  );
}

function CommandPalette({ open, setOpen }: PaletteContext) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const q = useDebouncedValue(query.trim(), 200);
  // Course material matches, once there's enough to search for.
  const material = useQuery({
    queryKey: ["search", "palette", q],
    queryFn: () => api.search({ q, limit: 5 }),
    enabled: open && q.length >= 3,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page or run an action"
    >
      {/* CommandDialog is only the dialog; cmdk needs its own <Command> root inside. */}
      <Command className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:uppercase">
        <CommandInput
          placeholder="Search pages and actions…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>Nothing matches that yet.</CommandEmpty>
          <CommandGroup heading="Go to">
            {allNav.map((item) => (
              <CommandItem
                key={item.to}
                value={item.label}
                keywords={item.keywords}
                onSelect={() => run(() => navigate({ to: item.to }))}
              >
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {q.length >= 3 && material.data?.hits.length ? (
            <CommandGroup heading="In your material">
              {material.data.hits.map((h) => (
                <CommandItem
                  key={h.chunkId}
                  value={`material ${h.chunkId}`}
                  // The server already matched these; let cmdk keep them for this query.
                  keywords={[query]}
                  onSelect={() =>
                    run(() =>
                      navigate({
                        to: "/documents/$documentId",
                        params: { documentId: h.documentId },
                        search: { tab: "read" },
                        hash: slugify(h.heading),
                      }),
                    )
                  }
                >
                  <FileText />
                  <span className="truncate">{h.documentTitle}</span>
                  <span className="ms-auto shrink-0 rounded-[6px] border bg-background px-1.5 py-px font-mono text-[11px] text-soft">
                    {anchorLabel(h.anchor)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {q.length >= 3 ? (
            <CommandGroup heading="Ask">
              <CommandItem
                value={`ask ${query}`}
                keywords={[query]}
                onSelect={() => run(() => navigate({ to: "/search", search: { mode: "ask", q } }))}
              >
                <MessageCircleQuestion />
                <span className="truncate">Ask “{q}”</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Theme">
            {themes.map((t) => (
              <CommandItem
                key={t.value}
                value={`Theme: ${t.label}`}
                onSelect={() => run(() => setTheme(t.value))}
              >
                <t.icon />
                Use {t.label.toLowerCase()} theme
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      <div className="flex items-center justify-end gap-1 border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
        Open anywhere with <CommandShortcut className="ml-1">⌘K</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
