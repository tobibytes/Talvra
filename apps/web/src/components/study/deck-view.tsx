import type { Anchor, FlashcardSet } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/time";
import { Cites } from "./cite";

export function DeckView({
  deck,
  documentId,
  slugFor,
}: {
  deck: FlashcardSet;
  documentId: string;
  slugFor: (a: Anchor) => string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <p className="text-sm">
          <span className="font-medium">{plural(deck.cards.length, "card")}</span>{" "}
          <span className="text-muted-foreground">
            in this deck. Reviews are scheduled for you.
          </span>
        </p>
        <Button render={<Link to="/review" search={{ documentId }} />}>
          <Layers /> Study these
        </Button>
      </div>
      <ol className="grid gap-3 md:grid-cols-2" aria-label="Flashcards">
        {deck.cards.map((card, i) => (
          <li key={card.front} className="space-y-2 rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Card {i + 1}</p>
            <p className="font-medium">{card.front}</p>
            <p className="text-sm text-muted-foreground">
              {card.back}
              <Cites documentId={documentId} cite={card.cite} slugFor={slugFor} />
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
