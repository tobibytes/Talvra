import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/courses/")({ component: Courses });

function Courses() {
  return (
    <>
      <PageHeader title="Courses" description="Everything synced from Canvas, by course." />
      <EmptyState
        icon={BookOpen}
        title="No courses yet"
        description="Your courses appear here after your first Canvas sync."
      />
    </>
  );
}
