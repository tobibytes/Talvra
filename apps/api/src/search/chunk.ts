import type { DocSection } from "@talvra/contracts";

export type ChunkDraft = {
  position: number;
  anchorKind: "page" | "slide" | "section";
  anchorN: number;
  heading: string;
  text: string;
};

/**
 * Splits sections into ~`target`-word chunks. Chunks never cross a section, so
 * every chunk keeps an exact citation (page/slide/section). Long sections are
 * windowed with a small overlap so a sentence at the boundary isn't lost.
 */
export function chunkSections(sections: DocSection[], target = 300, overlap = 40): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  for (const s of sections) {
    const words = s.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const base = { anchorKind: s.anchor.kind, anchorN: s.anchor.n, heading: s.heading };
    if (words.length <= target + overlap) {
      out.push({ ...base, position: out.length, text: words.join(" ") });
      continue;
    }
    for (let start = 0; start < words.length; start += target - overlap) {
      const slice = words.slice(start, start + target);
      out.push({ ...base, position: out.length, text: slice.join(" ") });
      if (start + target >= words.length) break;
    }
  }
  return out;
}

/** Text that gets embedded: heading gives the vector context. */
export const embedText = (c: Pick<ChunkDraft, "heading" | "text">) => `${c.heading}\n${c.text}`;
