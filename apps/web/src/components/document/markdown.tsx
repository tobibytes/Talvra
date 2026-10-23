import type * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[15px] text-foreground [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
