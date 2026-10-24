import type * as React from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Stable heading ids so the outline can link to them. */
export function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "section"
  );
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const heading =
  (Tag: "h1" | "h2" | "h3" | "h4", className: string) =>
  ({ children }: { children?: React.ReactNode }) => (
    <Tag
      id={slugify(textOf(children))}
      className={cn("scroll-mt-24 font-semibold tracking-tight", className)}
    >
      {children}
    </Tag>
  );

// Extracted text is untrusted: react-markdown never renders raw HTML (no
// rehype-raw), and links open in a new tab without referrer.
const components: Components = {
  h1: heading("h1", "mt-8 mb-4 text-2xl"),
  h2: heading("h2", "mt-8 mb-3 border-b pb-2 text-xl"),
  h3: heading("h3", "mt-6 mb-2 text-lg"),
  h4: heading("h4", "mt-4 mb-2 text-base"),
  p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 ps-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 ps-6">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-s-4 border-primary/30 bg-muted/40 py-1 ps-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-sm">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted/50 px-3 py-2 text-start font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-2 align-top">{children}</td>,
  hr: () => <hr className="my-6" />,
  img: () => null,
};

/**
 * `renderCite` turns `[n]` citations into custom links (the `cite:` scheme is
 * the only non-standard URL let through the sanitizer).
 */
/**
 * Small type and tight spacing for cards and chat (AI replies, notes, notebook cells).
 * Headings get no ids there: several replies on one page would repeat them.
 */
const plainHeading =
  (Tag: "h1" | "h2" | "h3" | "h4", className: string) =>
  ({ children }: { children?: React.ReactNode }) => (
    <Tag className={cn("font-semibold tracking-tight", className)}>{children}</Tag>
  );
const compactComponents: Components = {
  ...components,
  h1: plainHeading("h1", "mt-4 mb-2 text-lg"),
  h2: plainHeading("h2", "mt-4 mb-2 text-base"),
  h3: plainHeading("h3", "mt-3 mb-1.5 text-sm"),
  h4: plainHeading("h4", "mt-3 mb-1 text-sm"),
  p: ({ children }) => <p className="my-1.5 leading-6">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 ps-5">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-s-4 border-primary/30 bg-muted/40 py-0.5 ps-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border bg-muted/50 p-2.5 font-mono text-xs leading-5">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted/50 px-2 py-1.5 text-start font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-3" />,
};

export function Markdown({
  children,
  className,
  renderCite,
  compact = false,
}: {
  children: string;
  className?: string;
  renderCite?: (n: number) => React.ReactNode;
  /** Card/chat sizing (see compactComponents). */
  compact?: boolean;
}) {
  const base = compact ? compactComponents : components;
  const text = renderCite ? children.replace(/\[(\d{1,2})\]/g, "[$1](cite:$1)") : children;
  const comps: Components = renderCite
    ? {
        ...base,
        a: (props) =>
          props.href?.startsWith("cite:")
            ? renderCite(Number(props.href.slice(5)))
            : base.a
              ? (base.a as (p: typeof props) => React.ReactNode)(props)
              : null,
      }
    : base;
  return (
    <div
      className={cn(
        compact ? "text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0" : "text-[15px]",
        "text-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={comps}
        urlTransform={(url) => (/^cite:\d+$/.test(url) ? url : defaultUrlTransform(url))}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
