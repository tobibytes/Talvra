/**
 * Canvas descriptions are instructor HTML. Workers has no DOM, so this is a
 * conservative converter to Markdown. Safety doesn't depend on it: the result
 * is only ever rendered by the web app's Markdown component, which never
 * renders raw HTML. Unknown tags are dropped, their text kept.
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const safeHref = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

export function htmlToMarkdown(html: string | null | undefined): string | null {
  if (!html?.trim()) return null;
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|form|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\r\n?/g, "\n");
  // Links: keep http(s)/mailto only.
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      const url = decode(href);
      return safeHref(url) && label ? `[${label}](${url})` : label;
    },
  );
  s = s
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_m, n: string, t: string) => `\n\n${"#".repeat(Math.min(Number(n) + 1, 6))} ${t.trim()}\n\n`,
    )
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|table|tr|section|blockquote)>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s || null;
}
