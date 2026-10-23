import type { Anchor } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";

const label = (a: Anchor) =>
  a.kind === "page" ? `p. ${a.n}` : a.kind === "slide" ? `slide ${a.n}` : `§${a.n}`;

/**
 * Citation chips. Each opens the Read tab at that page/slide/section.
 * `slugFor` maps an anchor to the heading id in the reader.
 */
export function Cites({
  documentId,
  cite,
  slugFor,
}: {
  documentId: string;
  cite: Anchor[];
  slugFor: (a: Anchor) => string | null;
}) {
  if (!cite.length) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap gap-1 align-middle">
      {cite.map((a) => {
        const slug = slugFor(a);
        return (
          <Link
            key={`${a.kind}-${a.n}`}
            to="/documents/$documentId"
            params={{ documentId }}
            search={{ tab: "read" }}
            hash={slug ?? undefined}
            aria-label={`Source: ${label(a)}`}
            className="rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground no-underline outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {label(a)}
          </Link>
        );
      })}
    </span>
  );
}
