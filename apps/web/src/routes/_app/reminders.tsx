import { createFileRoute } from "@tanstack/react-router";
import { BellRing } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/_app/reminders")({ component: Reminders });

function Reminders() {
  return (
    <>
      <PageHeader title="Reminders" description="Due-date reminders and your weekly digest." />
      <EmptyState
        icon={BellRing}
        title="No reminder rules"
        description="Set reminders per course, like 3 days and 1 day before something is due."
      />
    </>
  );
}
