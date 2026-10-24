import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { IconTile, StatusPill } from "@/components/blocks";
import { ConnectCanvasForm } from "@/components/canvas/connect-canvas-form";
import { CoursePicker } from "@/components/canvas/course-picker";
import {
  BellRing,
  ChevronRight,
  Download,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  Smartphone,
  Trash2,
} from "@/components/icons";
import { PageHeader } from "@/components/page";
import { AiCard } from "@/components/settings/ai-card";
import { ApiKeysCard } from "@/components/settings/api-keys-card";
import { Facts, SettingsGroup, TileRow } from "@/components/settings/section";
import { SyncStatusCard } from "@/components/sync/sync-status-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignOut } from "@/components/user-menu";
import { api } from "@/lib/api";
import { authClient, authErrorMessage, meQuery } from "@/lib/auth";
import { dateTime, relativeTime } from "@/lib/time";

export const Route = createFileRoute("/_app/settings")({ component: Settings });

function Settings() {
  const me = useQuery(meQuery);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-8">
        <SettingsGroup id="settings-account" label="Account" index={0}>
          <ProfileCard />
          <SessionsCard />
        </SettingsGroup>
        <SettingsGroup id="settings-canvas" label="Canvas" index={1}>
          <CanvasCard />
          {me.data?.canvas ? <SyncStatusCard /> : null}
        </SettingsGroup>
        <SettingsGroup id="settings-ai" label="AI" index={2}>
          <AiCard />
          <ApiKeysCard />
        </SettingsGroup>
        {/* Reminders isn't in the mobile tab bar, so link it here. */}
        <SettingsGroup id="settings-notifications" label="Notifications" index={3}>
          <SettingsLink
            to="/reminders"
            icon={BellRing}
            title="Reminders"
            description="Rules and daily digest"
          />
        </SettingsGroup>
        <SettingsGroup id="settings-data" label="Your data" index={4}>
          <DataCard />
        </SettingsGroup>
      </div>
    </>
  );
}

function ProfileCard() {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const [name, setName] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: api.updateMe,
    onSuccess: (data) => {
      queryClient.setQueryData(meQuery.queryKey, data);
      setName(null);
      toast.success("Profile saved");
    },
  });
  if (!me.data) return null;
  const value = name ?? me.data.user.name;
  const dirty = value.trim() !== me.data.user.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Account</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ name: value });
          }}
        >
          <Field data-invalid={save.isError ? true : undefined}>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input
              id="profile-name"
              autoComplete="name"
              value={value}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldError errors={[{ message: save.error?.message }]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input id="profile-email" value={me.data.user.email} readOnly disabled />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? <LoaderCircle className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CanvasCard() {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const [dialog, setDialog] = React.useState<null | "token" | "courses" | "disconnect">(null);
  const verify = useMutation({
    mutationFn: api.verifyCanvas,
    onSuccess: (r) => toast.success(`Canvas is connected as ${r.canvasUserName}`),
    onError: (err) => toast.error(err.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectCanvas,
    onSuccess: async () => {
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      toast("Canvas disconnected");
    },
  });
  const canvas = me.data?.canvas;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Canvas</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canvas ? (
          <>
            <Facts
              items={[
                {
                  label: "Status",
                  value:
                    canvas.status === "active" ? (
                      <StatusPill tone="ok">Connected</StatusPill>
                    ) : (
                      <StatusPill tone="stop">Token not working, replace it</StatusPill>
                    ),
                },
                { label: "School", value: new URL(canvas.baseUrl).host },
                {
                  label: "Token",
                  value: <span className="font-mono">••••{canvas.tokenLast4}</span>,
                },
                {
                  label: "Last checked",
                  value: canvas.lastVerifiedAt ? (
                    <span title={dateTime(canvas.lastVerifiedAt)}>
                      {relativeTime(canvas.lastVerifiedAt)}
                    </span>
                  ) : (
                    "Never"
                  ),
                },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
                {verify.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                Check connection
              </Button>
              <Button variant="outline" onClick={() => setDialog("courses")}>
                Choose courses
              </Button>
              <Button variant="outline" onClick={() => setDialog("token")}>
                Replace token
              </Button>
              <Button variant="destructive" onClick={() => setDialog("disconnect")}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={() => setDialog("token")}>Connect Canvas</Button>
        )}
      </CardContent>

      <Dialog open={dialog === "token"} onOpenChange={(o) => setDialog(o ? "token" : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{canvas ? "Replace Canvas token" : "Connect Canvas"}</DialogTitle>
            <DialogDescription>Paste a new access token from Canvas.</DialogDescription>
          </DialogHeader>
          <ConnectCanvasForm
            initialBaseUrl={canvas?.baseUrl}
            submitLabel="Save token"
            onConnected={(r) => {
              setDialog(null);
              toast.success(`Connected as ${r.canvasUserName}`);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "courses"} onOpenChange={(o) => setDialog(o ? "courses" : null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose courses</DialogTitle>
            <DialogDescription>Only these courses sync.</DialogDescription>
          </DialogHeader>
          <CoursePicker
            onSaved={(n) => {
              setDialog(null);
              toast.success(`Following ${n} ${n === 1 ? "course" : "courses"}`);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "disconnect"}
        onOpenChange={(o) => setDialog(o ? "disconnect" : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Canvas?</DialogTitle>
            <DialogDescription>
              Your token is deleted and syncing stops. Synced material stays.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? <LoaderCircle className="animate-spin" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SessionsCard() {
  const signOut = useSignOut();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const [list, current] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      if (list.error) throw new Error(authErrorMessage(list.error));
      return { items: list.data, currentToken: current.data?.session.token };
    },
  });
  const others = sessions.data?.items.filter((s) => s.token !== sessions.data?.currentToken) ?? [];
  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await authClient.revokeOtherSessions();
      if (res.error) throw new Error(authErrorMessage(res.error));
    },
    onSuccess: () => {
      toast.success("Signed out everywhere else");
      sessions.refetch();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Devices</h2>
        </CardTitle>
        <CardDescription>Idle sessions end after 14 days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="-mx-2 grid gap-0.5">
            {(sessions.data?.items ?? []).map((s) => {
              const mobile = /mobile|iphone|android/i.test(s.userAgent ?? "");
              const current = s.token === sessions.data?.currentToken;
              return (
                <li key={s.id}>
                  <TileRow
                    tile={<IconTile icon={mobile ? Smartphone : Monitor} />}
                    title={describeAgent(s.userAgent)}
                    meta={`Signed in ${new Date(s.createdAt).toLocaleDateString()}`}
                    trailing={current ? <StatusPill tone="accent">This device</StatusPill> : null}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => revokeOthers.mutate()}
            disabled={!others.length || revokeOthers.isPending}
          >
            Sign out other devices
          </Button>
          <Button variant="ghost" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function describeAgent(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /edg/i.test(ua)
    ? "Edge"
    : /chrome/i.test(ua)
      ? "Chrome"
      : /firefox/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iphone|ipad/i.test(ua)
    ? "iOS"
    : /android/i.test(ua)
      ? "Android"
      : /mac/i.test(ua)
        ? "macOS"
        : /windows/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

function SettingsLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: "/reminders";
  icon: typeof BellRing;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors duration-150 outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <IconTile icon={Icon} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight
        className="size-4 text-muted-foreground transition-colors duration-150 group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

function DataCard() {
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const del = useMutation({
    mutationFn: () => api.deleteAccount(confirm),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/sign-in?deleted=1");
    },
  });
  const email = me.data?.user.email ?? "";
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Export</h3>
          </CardTitle>
          <CardDescription>Everything Talvra stores about you, as a file.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<a href={api.exportUrl} download />}>
            <Download /> Download my data
          </Button>
        </CardContent>
      </Card>
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle>
            <h3 className="text-destructive">Danger zone</h3>
          </CardTitle>
          <CardDescription>Deleting your account can't be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 /> Delete account
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setConfirm("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Everything in Talvra is deleted for good. Your Canvas account isn't touched.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              del.mutate();
            }}
          >
            <Field data-invalid={del.isError ? true : undefined}>
              <FieldLabel htmlFor="delete-confirm">Type {email} to confirm</FieldLabel>
              <Input
                id="delete-confirm"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <FieldError errors={[{ message: del.error?.message }]} />
            </Field>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirm.trim().toLowerCase() !== email.toLowerCase() || del.isPending}
              >
                {del.isPending ? <LoaderCircle className="animate-spin" /> : null}
                Delete forever
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
