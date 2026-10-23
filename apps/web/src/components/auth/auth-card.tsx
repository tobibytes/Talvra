import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import type * as React from "react";
import { Card } from "@/components/ui/card";

/** Centered card used by every signed-out screen. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-4" />
        </span>
        Talvra
      </Link>
      <Card className="w-full max-w-sm gap-6 p-6 sm:p-8">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </Card>
      {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
    </main>
  );
}

/** "or" divider between social and email sign-in. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
