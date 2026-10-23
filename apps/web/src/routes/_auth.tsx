import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { meQuery } from "@/lib/auth";

/** Signed-out screens. Already signed in? Skip straight to the app. */
export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ to: me.onboarded ? "/" : "/onboarding" });
  },
  component: Outlet,
});
