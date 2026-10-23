import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BellRing,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConnectCanvasForm } from "@/components/canvas/connect-canvas-form";
import { CoursePicker } from "@/components/canvas/course-picker";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_app/settings")({ component: Settings });

function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <ProfileCard />
        <CanvasCard />
        <SessionsCard />
        {/* Reminders and the gallery aren't in the mobile tab bar, so link them here. */}
        <div className="space-y-3">
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
        <CardDescription>Your name appears on Today and in emails.</CardDescription>
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
        <CardDescription>Talvra reads your courses with a personal access token.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canvas ? (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {canvas.status === "active" ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Badge variant="destructive">Token not working, replace it</Badge>
                )}
              </dd>
              <dt className="text-muted-foreground">Canvas</dt>
              <dd>{new URL(canvas.baseUrl).host}</dd>
              <dt className="text-muted-foreground">Token</dt>
              <dd className="font-mono">••••{canvas.tokenLast4}</dd>
              <dt className="text-muted-foreground">Last checked</dt>
              <dd>
                {canvas.lastVerifiedAt ? new Date(canvas.lastVerifiedAt).toLocaleString() : "Never"}
              </dd>
            </dl>
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
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setDialog("disconnect")}
              >
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
            <DialogDescription>Talvra only syncs the courses you pick.</DialogDescription>
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
              Talvra deletes your stored token and stops syncing. Material already synced stays
              until you delete your account. You can reconnect anytime.
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
          <h2>Where you're signed in</h2>
        </CardTitle>
        <CardDescription>Sessions end after 14 days without use.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="divide-y rounded-xl border">
            {(sessions.data?.items ?? []).map((s) => {
              const mobile = /mobile|iphone|android/i.test(s.userAgent ?? "");
              const Icon = mobile ? Smartphone : Monitor;
              const current = s.token === sessions.data?.currentToken;
              return (
                <li key={s.id} className="flex items-center gap-3 p-4 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{describeAgent(s.userAgent)}</p>
                    <p className="text-xs text-muted-foreground">
                      Signed in {new Date(s.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {current ? <Badge variant="secondary">This device</Badge> : null}
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
