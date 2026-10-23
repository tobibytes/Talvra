import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, ChevronRight, LayoutGrid, PlugZap, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/settings")({ component: Settings });

const sections = [
  { icon: UserRound, title: "Account", description: "Name, email and sign-in", soon: true },
  {
    icon: PlugZap,
    title: "Canvas connection",
    description: "Connect and check your Canvas token",
    soon: true,
  },
] as const;

function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-3">
        {sections.map((s) => (
          <Card key={s.title} className="flex-row items-center gap-4 p-4">
            <s.icon className="size-5 text-muted-foreground" aria-hidden />
            <div className="flex-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.description}</p>
            </div>
            {s.soon ? <Badge variant="secondary">Next session</Badge> : null}
          </Card>
        ))}
        {/* Reminders and the gallery are not in the mobile tab bar, so link them here. */}
        <SettingsLink
          to="/reminders"
          icon={BellRing}
          title="Reminders"
          description="Notification rules and digest"
        />
        <SettingsLink
          to="/gallery"
          icon={LayoutGrid}
          title="Component gallery"
          description="Every UI component in both themes"
        />
      </div>
    </>
  );
}

function SettingsLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: "/reminders" | "/gallery";
  icon: typeof BellRing;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}
