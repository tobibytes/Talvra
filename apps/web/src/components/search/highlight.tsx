import { HIGHLIGHT_END, HIGHLIGHT_START } from "@talvra/contracts";

/** Renders « » markers from the server as <mark>; everything else is plain text. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${HIGHLIGHT_START}[^${HIGHLIGHT_END}]*${HIGHLIGHT_END})`));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith(HIGHLIGHT_START) && p.endsWith(HIGHLIGHT_END) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: fragments of one string
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export const anchorLabel = (a: { kind: string; n: number }) =>
  a.kind === "page" ? `p. ${a.n}` : a.kind === "slide" ? `slide ${a.n}` : `§${a.n}`;
