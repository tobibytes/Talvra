import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { MapPinOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: () => (
    <EmptyState
      icon={MapPinOff}
      title="Page not found"
      description="That page doesn't exist or has moved."
      action={<Button render={<Link to="/" />}>Back to Today</Button>}
    />
  ),
});
