import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SyncLiveProvider } from "@/hooks/use-sync-live";
import { meQuery } from "@/lib/auth";

/**
 * Every signed-in page lives under this layout. Signed-out visitors go to
 * sign-in (and come back afterwards); users who haven't finished setup go to
 * onboarding.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (!me.onboarded) throw redirect({ to: "/onboarding" });
    return { me };
  },
  component: () => (
    <SyncLiveProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </SyncLiveProvider>
  ),
});
