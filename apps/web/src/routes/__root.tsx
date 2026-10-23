import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">That page doesn't exist or has moved.</p>
      <Link to="/" className="mt-6 inline-block text-primary underline-offset-4 hover:underline">
        Back to Talvra
      </Link>
    </div>
  ),
});

// Placeholder chrome. Session 2 replaces this with the sidebar / bottom-bar shell.
function RootLayout() {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Talvra
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
