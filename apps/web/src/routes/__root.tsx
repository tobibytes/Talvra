import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import { MapPinOff } from "@/components/icons";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // nuqs keeps data-table filters/sorting in the URL (shareable, survives reload).
  component: () => (
    <NuqsAdapter>
      <Outlet />
    </NuqsAdapter>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={MapPinOff}
        title="Page not found"
        description="That page doesn't exist or has moved."
        action={<Button render={<Link to="/" />}>Back to Talvra</Button>}
      />
    </main>
  ),
});
