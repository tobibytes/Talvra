import type { Anchor, FlashcardSet } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { IconTile } from "@/components/blocks";
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <IconTile icon={Layers} />
          <p className="grid text-sm">
            <span className="font-semibold">{plural(deck.cards.length, "card")}</span>
            <span className="text-xs text-muted-foreground">Reviews are scheduled for you</span>
          </p>
        </div>
        <Button render={<Link to="/review" search={{ documentId }} />}>
          <Layers /> Study these
        </Button>
      </div>
      <ol className="grid gap-3 md:grid-cols-2" aria-label="Flashcards">
        {deck.cards.map((card, i) => (
          <li
            key={card.front}
            className="animate-rise space-y-2 rounded-2xl border bg-card p-4 sm:p-5"
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
          >
            <p className="font-mono text-[11px] text-muted-foreground" data-numeric>
              <span className="sr-only">Card {i + 1}</span>
              <span aria-hidden>{String(i + 1).padStart(2, "0")}</span>
            </p>
            <p className="font-semibold">{card.front}</p>
            <p className="border-t pt-2 text-sm text-muted-foreground">
              {card.back}
              <Cites documentId={documentId} cite={card.cite} slugFor={slugFor} />
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
