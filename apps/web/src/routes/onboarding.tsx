import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { BrandMark, heroGlow } from "@/components/auth/auth-card";
import { ConnectCanvasForm } from "@/components/canvas/connect-canvas-form";
import { CoursePicker } from "@/components/canvas/course-picker";
import { CircleCheck, LoaderCircle, LogOut } from "@/components/icons";
import { SyncProgress } from "@/components/sync/sync-progress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSignOut } from "@/components/user-menu";
import { isActive, latestRunQuery, SyncLiveProvider, useLatestRun } from "@/hooks/use-sync-live";
import { api } from "@/lib/api";
import { meQuery } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/sign-in" });
    if (me.onboarded) throw redirect({ to: "/" });
    return { me };
  },
  component: Onboarding,
});

const steps = ["Connect Canvas", "Pick courses", "All set"] as const;

function Onboarding() {
  const { me } = Route.useRouteContext();
  // Resume where they left off: Canvas already connected means step 2.
  const [step, setStep] = React.useState(me.canvas ? 1 : 0);
  const [canvasName, setCanvasName] = React.useState<string | null>(null);
  const [courseCount, setCourseCount] = React.useState(0);
  const signOut = useSignOut();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading so screen readers announce it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on step change on purpose
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  return (
    <SyncLiveProvider>
      <main className="relative min-h-dvh overflow-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={heroGlow} />
        <div className="relative mx-auto max-w-xl space-y-8 px-4 py-8 sm:py-12">
          <div className="flex items-center justify-between gap-3">
            <BrandMark />
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="hidden truncate text-sm text-muted-foreground sm:inline"
                title={me.user.email}
              >
                {me.user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut /> Sign out
              </Button>
            </div>
          </div>

          <Stepper current={step} />

          <Card key={step} className="animate-rise gap-6 p-6 sm:p-8">
            {step === 0 ? (
              <>
                <StepHeading ref={headingRef} title={`Welcome, ${me.user.name.split(" ")[0]}`}>
                  Connect Canvas to bring in your courses.
                </StepHeading>
                <ConnectCanvasForm
                  onConnected={(r) => {
                    setCanvasName(r.canvasUserName);
                    setStep(1);
                  }}
                />
              </>
            ) : step === 1 ? (
              <>
                <StepHeading ref={headingRef} title="Pick your courses">
                  {canvasName ? `Connected as ${canvasName}. ` : ""}Choose this term's classes. You
                  can change them later.
                </StepHeading>
                <CoursePicker
                  submitLabel="Continue"
                  onSaved={(n) => {
                    setCourseCount(n);
                    setStep(2);
                  }}
                />
              </>
            ) : (
              <Finish ref={headingRef} courseCount={courseCount} />
            )}
          </Card>
        </div>
      </main>
    </SyncLiveProvider>
  );
}

/** "01 / 03" index, the step's name, and a segmented progress bar. */
function Stepper({ current }: { current: number }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="space-y-3">
      <p className="flex items-baseline gap-3">
        <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground" data-numeric>
          {pad(current + 1)} / {pad(steps.length)}
        </span>
        <span className="font-mono text-xs tracking-[0.12em] text-foreground uppercase">
          {steps[current]}
        </span>
      </p>
      <ol className="grid grid-cols-3 gap-1.5" aria-label="Setup progress">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined}>
              <span
                aria-hidden
                className={cn(
                  "block h-1.5 rounded-full transition-colors duration-500",
                  done || active ? "bg-primary" : "bg-secondary",
                  active && "opacity-60",
                )}
              />
              <span className="sr-only">
                {label}
                {done ? " (done)" : active ? " (current)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const StepHeading = React.forwardRef<
  HTMLHeadingElement,
  { title: string; children: React.ReactNode }
>(({ title, children }, ref) => (
  <div className="space-y-1.5">
    <h1
      ref={ref}
      tabIndex={-1}
      className="font-display text-2xl font-extrabold tracking-tight outline-none sm:text-3xl"
    >
      {title}
    </h1>
    <p className="text-sm text-muted-foreground">{children}</p>
  </div>
));

/**
 * Finishing setup starts the first sync on the server. This step finishes
 * setup as soon as it appears and then shows that sync live. "Go to Today"
 * works anytime; the sync keeps running in the background.
 */
const Finish = React.forwardRef<HTMLHeadingElement, { courseCount: number }>(
  ({ courseCount }, ref) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const run = useLatestRun();
    const finish = useMutation({
      mutationFn: api.completeOnboarding,
      onSuccess: async (me) => {
        queryClient.setQueryData(meQuery.queryKey, me);
        await queryClient.invalidateQueries({ queryKey: latestRunQuery.queryKey });
      },
    });
    const started = React.useRef(false);
    React.useEffect(() => {
      if (started.current) return;
      started.current = true;
      finish.mutate();
    }, [finish]);

    const r = run.data;
    const syncing = isActive(r);
    return (
      <div className="space-y-6">
        <div className="space-y-5">
          <span className="grid size-12 place-items-center rounded-[14px] bg-success/12 text-success">
            <CircleCheck className="size-6" aria-hidden />
          </span>
          <StepHeading ref={ref} title="You're all set">
            {syncing
              ? "Syncing from Canvas. It keeps going if you leave."
              : r?.status === "succeeded"
                ? "Your courses are ready."
                : `${courseCount === 1 ? "Your course stays" : "Your courses stay"} in sync with Canvas.`}
          </StepHeading>
        </div>
        {finish.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Finishing setup…
          </p>
        ) : null}
        {r && finish.isSuccess ? <SyncProgress run={r} /> : null}
        {r?.status === "failed" && finish.isSuccess ? (
          <p role="alert" className="text-sm text-destructive">
            {r.error ?? "The first sync didn't finish."} You can sync again from Today.
          </p>
        ) : null}
        {finish.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{finish.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => finish.mutate()}>
              Try again
            </Button>
          </div>
        ) : null}
        <Button
          className="w-full"
          onClick={() => navigate({ to: "/" })}
          disabled={!finish.isSuccess}
        >
          Go to Today
        </Button>
      </div>
    );
  },
);
