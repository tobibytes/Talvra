import { createFileRoute } from "@tanstack/react-router";
import { Search as SearchIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/_app/search")({ component: Search });

function Search() {
  return (
    <>
      <PageHeader title="Search" description="Search across all your course material." />
      <EmptyState
        icon={SearchIcon}
        title="Search is coming"
        description="Once your files are processed you can search them here and ask questions with cited answers."
      />
    </>
  );
}
