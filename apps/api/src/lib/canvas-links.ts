import { CANVAS_HOST_PATTERN } from "@talvra/contracts";

export type LinkedFile = { canvasId: string; label: string | null };

const FILE_PATH = /(?:^|\/)files\/(\d+)(?=[/?#]|$)/;
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ATTR = /\b(href|data-api-endpoint)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** A Canvas file id from a link, if it points at a Canvas file (relative or on a Canvas host). */
function fileIdOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/g, "&"), "https://canvas.invalid");
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host !== "canvas.invalid" && !CANVAS_HOST_PATTERN.test(host)) return null;
  return url.pathname.match(FILE_PATH)?.[1] ?? null;
}

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Canvas files linked from an assignment description (the attached PDF with the
 * questions, datasets, templates), in order, without duplicates.
 */
export function linkedFiles(html: string | null | undefined, max = 10): LinkedFile[] {
  if (!html) return [];
  const out = new Map<string, LinkedFile>();
  for (const a of html.matchAll(ANCHOR)) {
    let id: string | null = null;
    for (const m of (a[1] ?? "").matchAll(ATTR)) {
      id = fileIdOf(m[3] ?? m[4] ?? "");
      if (id) break;
    }
    if (!id || out.has(id)) continue;
    out.set(id, { canvasId: id, label: text(a[2] ?? "") || null });
    if (out.size >= max) break;
  }
  return [...out.values()];
}
