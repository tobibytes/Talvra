import { REMINDER_OFFSETS, type ReminderPrefs } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, Check, LoaderCircle, Mail, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { dateTime, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/reminders")({ component: Reminders });

const hourLabel = (h: number) =>
  new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }));
const offsetLabel = (m: number) =>
  REMINDER_OFFSETS.find((o) => o.minutes === m)?.label ?? `${m} min before`;

function HourSelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (h: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select
        value={String(value)}
        onValueChange={(v) => onChange(Number(v))}
        items={HOURS}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-36">
          <SelectValue>{hourLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h.value} value={h.value}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Reminders() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["reminders"], queryFn: api.reminders });
  const save = useMutation({
    mutationFn: api.saveReminderPrefs,
    onMutate: async (patch) => {
      // Optimistic: the switch/chip responds instantly; rolled back on error.
      const prev = queryClient.getQueryData(["reminders"]);
      queryClient.setQueryData(["reminders"], (o: typeof overview.data) =>
        o ? { ...o, prefs: { ...o.prefs, ...patch } } : o,
      );
      return { prev };
    },
    onError: (err, _p, ctx) => {
      queryClient.setQueryData(["reminders"], ctx?.prev);
      toast.error(err.message);
    },
    onSuccess: (data) => queryClient.setQueryData(["reminders"], data),
  });
  const test = useMutation({
    mutationFn: api.testReminder,
    onSuccess: (r) => {
      toast.success(`Test email sent to ${r.sentTo}`);
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: (err) => toast.error(err.message),
  });
  const detected = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  if (overview.isPending) return <ListSkeleton rows={4} />;
  if (overview.isError)
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const { prefs, upcoming, history } = overview.data;
  const set = (patch: Partial<ReminderPrefs>) => save.mutate(patch);
  const off = !prefs.emailEnabled;

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Email nudges and a daily digest."
        actions={
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? <LoaderCircle className="animate-spin" /> : <Send />} Send a test
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>
                  <h2 id="email-heading">Email reminders</h2>
                </CardTitle>
                <CardDescription>Only for unsubmitted work.</CardDescription>
              </div>
              <Switch
                aria-labelledby="email-heading"
                checked={prefs.emailEnabled}
                onCheckedChange={(v) => set({ emailEnabled: v })}
              />
            </CardHeader>
            <CardContent className={cn("space-y-6", off && "opacity-60")}>
              <fieldset className="space-y-2" disabled={off}>
                <legend className="text-sm font-medium">Remind me</legend>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_OFFSETS.map((o) => {
                    const on = prefs.offsets.includes(o.minutes);
                    return (
                      <Button
                        key={o.minutes}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() =>
                          set({
                            offsets: on
                              ? prefs.offsets.filter((m) => m !== o.minutes)
                              : [...prefs.offsets, o.minutes],
                          })
                        }
                      >
                        {on ? <Check /> : null}
                        {o.label}
                      </Button>
                    );
                  })}
                </div>
                {!prefs.offsets.length && !off ? (
                  <p className="text-sm text-muted-foreground">No due-date reminders.</p>
                ) : null}
              </fieldset>
              <fieldset className="space-y-2" disabled={off}>
                <legend className="text-sm font-medium">Quiet hours</legend>
                <p className="text-sm text-muted-foreground">
                  Held until morning unless something is due sooner.
                </p>
                <div className="flex flex-wrap gap-4">
                  <HourSelect
                    id="quiet-start"
                    label="From"
                    value={prefs.quietStart}
                    onChange={(h) => set({ quietStart: h })}
                    disabled={off}
                  />
                  <HourSelect
                    id="quiet-end"
                    label="Until"
                    value={prefs.quietEnd}
                    onChange={(h) => set({ quietEnd: h })}
                    disabled={off}
                  />
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Time zone</p>
                <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  <span>{prefs.timezone.replace(/_/g, " ")}</span>
                  {detected && detected !== prefs.timezone ? (
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => set({ timezone: detected })}
                    >
                      Use {detected.replace(/_/g, " ")} (this device)
                    </button>
                  ) : null}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>
                  <h2 id="digest-heading">Daily digest</h2>
                </CardTitle>
                <CardDescription>
                  Overdue work, the next two days and cards due. Skipped on quiet days.
                </CardDescription>
              </div>
              <Switch
                aria-labelledby="digest-heading"
                checked={prefs.digestEnabled}
                disabled={off}
                onCheckedChange={(v) => set({ digestEnabled: v })}
              />
            </CardHeader>
            <CardContent>
              <HourSelect
                id="digest-hour"
                label="Send at"
                value={prefs.digestHour}
                onChange={(h) => set({ digestHour: h })}
                disabled={off || !prefs.digestEnabled}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="upcoming-heading" className="space-y-2">
            <h2 id="upcoming-heading" className="font-semibold">
              Coming up
            </h2>
            {off ? (
              <p className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                <BellOff className="size-4" aria-hidden /> Email reminders are off.
              </p>
            ) : upcoming.length ? (
              <ul className="divide-y rounded-xl border bg-card">
                {upcoming.map((u) => (
                  <li
                    key={`${u.assignmentId}-${u.offsetMinutes}`}
                    className="space-y-0.5 p-3 text-sm"
                  >
                    <Link
                      to="/homework/$assignmentId"
                      params={{ assignmentId: u.assignmentId }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {u.assignmentName}
                    </Link>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span title={dateTime(u.remindAt)}>{relativeTime(u.remindAt)}</span>
                      <span>{offsetLabel(u.offsetMinutes)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                No reminders in the next 7 days.
              </p>
            )}
          </section>
          <section aria-labelledby="history-heading" className="space-y-2">
            <h2 id="history-heading" className="font-semibold">
              Recently sent
            </h2>
            {history.length ? (
              <ul className="divide-y rounded-xl border bg-card">
                {history.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 p-3 text-sm">
                    <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        {n.subject ?? (n.kind === "digest" ? "Daily digest" : "Reminder")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {relativeTime(n.sentAt ?? n.scheduledFor)}
                        {n.error ? <span className="block">{n.error}</span> : null}
                      </p>
                    </div>
                    <Badge
                      variant={
                        n.status === "sent"
                          ? "success"
                          : n.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {n.status === "sent"
                        ? "Sent"
                        : n.status === "failed"
                          ? "Failed"
                          : n.status === "skipped"
                            ? "Skipped"
                            : "Queued"}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                Nothing sent yet.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
