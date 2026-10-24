import { CircleAlert, RefreshCw } from "lucide-react";
import type * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api";

/** Page title + description + optional actions. Every page starts with one. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <h1 className="animate-rise font-display text-[clamp(30px,4vw,40px)] leading-[1.05] font-extrabold tracking-[-0.02em]">
          {title}
        </h1>
        {description ? (
          <p className="animate-rise text-soft [animation-delay:60ms]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex animate-fade gap-2 [animation-delay:120ms]">{actions}</div>
      ) : null}
    </div>
  );
}

/** The designed empty state. Use instead of blank areas or "No data". */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Empty className="animate-rise border bg-card py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** The designed error state. Shows the request id so users can report it. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : "Something went wrong. Please try again.";
  const requestId = error instanceof ApiRequestError ? error.requestId : undefined;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Couldn't load this</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {requestId ? <p className="font-mono text-xs opacity-80">Reference: {requestId}</p> : null}
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Loading skeleton shaped like a list of rows. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
