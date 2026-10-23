import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Check, CircleCheck, LoaderCircle, LogOut } from "lucide-react";
import * as React from "react";
import { ConnectCanvasForm } from "@/components/canvas/connect-canvas-form";
import { CoursePicker } from "@/components/canvas/course-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSignOut } from "@/components/user-menu";
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
    <main className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{me.user.email}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>

        <Stepper current={step} />

        <Card className="gap-6 p-6 sm:p-8">
          {step === 0 ? (
            <>
              <StepHeading ref={headingRef} title={`Welcome, ${me.user.name.split(" ")[0]}`}>
                Connect your Canvas account so Talvra can bring in your courses, files and due
                dates.
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
                {canvasName ? `Connected as ${canvasName}. ` : ""}Choose the classes you want help
                with this term. You can change this later in Settings.
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
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                active ? "font-medium" : "text-muted-foreground",
                "hidden sm:inline",
              )}
            >
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {i < steps.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

const StepHeading = React.forwardRef<
  HTMLHeadingElement,
  { title: string; children: React.ReactNode }
>(({ title, children }, ref) => (
  <div className="space-y-1.5">
    <h1 ref={ref} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
      {title}
    </h1>
    <p className="text-sm text-muted-foreground">{children}</p>
  </div>
));

const Finish = React.forwardRef<HTMLHeadingElement, { courseCount: number }>(
  ({ courseCount }, ref) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const finish = useMutation({
      mutationFn: api.completeOnboarding,
      onSuccess: async (me) => {
        queryClient.setQueryData(meQuery.queryKey, me);
        await navigate({ to: "/" });
      },
    });
    return (
      <div className="space-y-6 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <StepHeading ref={ref} title="You're all set">
          Talvra will keep {courseCount === 1 ? "your course" : `your ${courseCount} courses`} in
          sync with Canvas. Your due dates and material will appear on Today.
        </StepHeading>
        {finish.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {finish.error.message}
          </p>
        ) : null}
        <Button className="w-full" onClick={() => finish.mutate()} disabled={finish.isPending}>
          {finish.isPending ? <LoaderCircle className="animate-spin" /> : null}
          Go to Today
        </Button>
      </div>
    );
  },
);
