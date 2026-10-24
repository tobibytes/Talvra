import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { plural } from "@/lib/time";

/** Today: how many flashcards are due, and a way in. */
export function StudyCard() {
  const summary = useQuery({ queryKey: ["study", "summary"], queryFn: api.studySummary });
  const s = summary.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Flashcards</h2>
        </CardTitle>
        <CardDescription>
          {summary.isPending ? (
            <Skeleton className="h-4 w-32" />
          ) : !s || (s.dueNow === 0 && s.newCards === 0 && s.reviewedToday === 0) ? (
            "Make flashcards from any document to start reviewing."
          ) : s.dueNow ? (
            `${plural(s.dueNow, "card")} due now${s.reviewedToday ? ` · ${s.reviewedToday} reviewed today` : ""}.`
          ) : (
            `All caught up${s.reviewedToday ? `: ${plural(s.reviewedToday, "card")} reviewed today` : ""}.`
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {s?.dueNow ? (
          <Button render={<Link to="/review" />}>
            <Layers /> Review {plural(s.dueNow, "card")}
          </Button>
        ) : (
          <Button variant="outline" render={<Link to="/courses" />}>
            Find something to study
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
