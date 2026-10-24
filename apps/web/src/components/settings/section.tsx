import type * as React from "react";
import { SectionLabel } from "@/components/blocks";
import { cn } from "@/lib/utils";

/** A labeled group of settings cards (Account, Canvas, AI, ...). */
export function SettingsGroup({
  id,
  label,
  index = 0,
  children,
}: {
  id: string;
  label: string;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="animate-rise space-y-3"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <SectionLabel id={id}>{label}</SectionLabel>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Label/value pairs in two columns (one on phones), the family "facts" block. */
export function Facts({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-5 gap-y-4 rounded-xl border px-4 py-3.5 sm:grid-cols-2",
        className,
      )}
    >
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="mb-1 text-xs text-muted-foreground">{f.label}</dt>
          <dd className="truncate text-sm">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A row with a leading icon tile: title, meta line, trailing slot. */
export function TileRow({
  tile,
  title,
  meta,
  trailing,
  className,
}: {
  tile: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-2 py-2.5", className)}>
      {tile}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="truncate text-sm font-semibold">{title}</p>
        {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {trailing}
    </div>
  );
}
