import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import * as React from "react";
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
      <Command>
        <CommandInput placeholder="Search pages and actions…" />
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
      <div className="flex items-center justify-end gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
        Open anywhere with <CommandShortcut className="ml-1">⌘K</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
