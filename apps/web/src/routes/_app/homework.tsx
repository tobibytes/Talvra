import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/_app/homework")({ component: Homework });

function Homework() {
  return (
    <>
      <PageHeader
        title="Homework"
        description="Briefs, related material and a plan for each assignment. Talvra helps you study; it never writes or submits your work."
      />
      <EmptyState
        icon={ClipboardList}
        title="No assignments yet"
        description="Upcoming assignments from Canvas will be listed here with a study plan."
      />
    </>
  );
}
