import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, PlugZap } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <>
      <PageHeader title="Today" description={today} />
      {/* Session 3 adds onboarding; session 8 fills this with real due dates. */}
      <EmptyState
        icon={CalendarCheck}
        title="Nothing here yet"
        description="Connect Canvas and your due dates, recent material and flashcards to review will show up here."
        action={
          <Button render={<Link to="/settings" />}>
            <PlugZap /> Connect Canvas
          </Button>
        }
      />
    </>
  );
}
