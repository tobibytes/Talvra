import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE, api } from "@/lib/api";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Talvra v2</h1>
        <p className="text-muted-foreground">
          Foundation build. Login, Canvas sync and your Today dashboard arrive in the next sessions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API status</CardTitle>
          <CardDescription>
            Checking <code className="font-mono text-xs">{API_BASE}/health</code>
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          {health.isPending ? (
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-32" />
            </div>
          ) : health.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="destructive">
                <CircleAlert /> Unreachable
              </Badge>
              <span className="text-muted-foreground">
                Start it with{" "}
                <code className="font-mono text-xs">pnpm --filter @talvra/api dev</code>
              </span>
              <Button variant="outline" size="sm" onClick={() => health.refetch()}>
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={health.data.status === "ok" ? "success" : "warning"}>
                <CircleCheck /> {health.data.status === "ok" ? "Healthy" : "Degraded"}
              </Badge>
              <span className="text-muted-foreground">
                v{health.data.version} · database {health.data.checks.database}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
