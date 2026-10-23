import { useQuery } from "@tanstack/react-query";
import { API_BASE, api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Small live indicator for the sidebar footer. Calls API_BASE/health (not a
 * relative path, which was the v1 banner bug) and re-checks every minute.
 */
export function ApiStatus({ className }: { className?: string }) {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    retry: false,
    refetchInterval: 60_000,
  });
  const state = health.isPending
    ? { dot: "bg-muted-foreground animate-pulse", label: "Checking API…" }
    : health.isError
      ? { dot: "bg-destructive", label: "API unreachable" }
      : health.data.status === "ok"
        ? { dot: "bg-success", label: "All systems normal" }
        : { dot: "bg-warning", label: "API degraded" };
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
      role="status"
      title={`${API_BASE}/health`}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", state.dot)} />
      <span className="truncate">{state.label}</span>
    </div>
  );
}
