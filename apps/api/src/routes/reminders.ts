import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, RemindersOverview, UpdateReminderPrefs } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { emailSender, type SendEmail } from "../lib/email.js";
import { AppError } from "../lib/errors.js";
import { testEmail } from "../lib/notify-email.js";
import { meter } from "../lib/usage.js";
import { requireUser } from "../middleware/auth.js";
import { getPrefs, history, savePrefs, upcomingReminders } from "../reminders/engine.js";
import { unsubscribeUrl, verifyUnsubscribe } from "../reminders/unsubscribe.js";

const { notifications, users } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const unauthorized = { 401: { description: "Not signed in", content: json(ApiError) } };

const overview = createRoute({
  method: "get",
  path: "/reminders",
  tags: ["reminders"],
  summary: "Reminder settings, what's coming up, and what was sent",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Overview", content: json(RemindersOverview) },
    ...unauthorized,
  },
});

const update = createRoute({
  method: "put",
  path: "/reminders/prefs",
  tags: ["reminders"],
  summary: "Change reminder settings",
  middleware: [requireUser] as const,
  request: { body: { content: json(UpdateReminderPrefs), required: true } },
  responses: {
    200: { description: "Overview", content: json(RemindersOverview) },
    ...unauthorized,
  },
});

const test = createRoute({
  method: "post",
  path: "/reminders/test",
  tags: ["reminders"],
  summary: "Send a test email now",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Sent", content: json(z.object({ sentTo: z.string() })) },
    429: { description: "Too many tests", content: json(ApiError) },
    ...unauthorized,
  },
});

export function remindersRoutes(sendOverride?: SendEmail) {
  const send = (env: AppEnv["Bindings"]) => sendOverride ?? emailSender(env);
  const load = async (db: AppEnv["Variables"]["db"], userId: string) => {
    const prefs = await getPrefs(db, userId);
    return {
      prefs,
      upcoming: await upcomingReminders(db, userId, prefs),
      history: await history(db, userId),
    };
  };
  return new OpenAPIHono<AppEnv>()
    .openapi(overview, async (c) => c.json(await load(c.var.db, c.get("userId") as string), 200))
    .openapi(update, async (c) => {
      const userId = c.get("userId") as string;
      await savePrefs(c.var.db, userId, c.req.valid("json"));
      return c.json(await load(c.var.db, userId), 200);
    })
    .openapi(test, async (c) => {
      const userId = c.get("userId") as string;
      const db = c.var.db;
      await meter(db, userId, "reminder_test", {
        limit: 3,
        windowMs: 3600_000,
        message: "That's a few tests already. Try again in an hour.",
      });
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new AppError("unauthorized", "Sign in to continue.");
      const message = testEmail({
        to: user.email,
        appUrl: c.env.APP_URL,
        unsubscribeUrl: await unsubscribeUrl(c.env.APP_URL, c.env.BETTER_AUTH_SECRET, userId),
      });
      await send(c.env)(message);
      await db.insert(notifications).values({
        userId,
        kind: "test",
        dedupeKey: `test:${crypto.randomUUID()}`,
        scheduledFor: new Date(),
        status: "sent",
        sentAt: new Date(),
        subject: message.subject,
        attempts: 1,
      });
      return c.json({ sentTo: user.email }, 200);
    });
}

const page = (
  title: string,
  body: string,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Talvra</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#111}
a{color:#1d4ed8}@media (prefers-color-scheme:dark){body{background:#0b0b0c;color:#eee}a{color:#93b4ff}}</style></head>
<body><h1 style="font-size:1.4rem">${title}</h1>${body}</body></html>`;

/**
 * Public one-click unsubscribe (no sign-in): GET from the email link shows a
 * page; POST is RFC 8058 List-Unsubscribe-Post from mail providers.
 */
export const unsubscribeRoutes = new OpenAPIHono<AppEnv>().on(
  ["GET", "POST"],
  "/unsubscribe",
  async (c) => {
    const token = c.req.query("token") ?? "";
    const userId = await verifyUnsubscribe(c.env.BETTER_AUTH_SECRET, token);
    const html = (title: string, body: string, status: 200 | 400) =>
      c.html(page(title, body), status, {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
    if (!userId) {
      return html(
        "That link didn't work",
        `<p>Open Talvra and turn off emails in <a href="/reminders">Reminders</a>.</p>`,
        400,
      );
    }
    // GET only asks: mail security scanners open links, and must not unsubscribe anyone.
    // POST (the button, or RFC 8058 one-click from the mail provider) does it.
    if (c.req.method === "GET") {
      return html(
        "Turn off Talvra emails?",
        `<p>You'll stop getting due-date reminders and the daily digest. You can turn them back on anytime in Reminders.</p>
<form method="post" action="/api/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit" style="font:inherit;padding:.6rem 1rem;border-radius:.5rem;border:0;background:#1d4ed8;color:#fff;cursor:pointer">Turn off emails</button></form>`,
        200,
      );
    }
    const [user] = await c.var.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user) await savePrefs(c.var.db, userId, { emailEnabled: false });
    if (
      c.req.header("content-type")?.includes("application/x-www-form-urlencoded") &&
      c.req.header("sec-fetch-mode") !== "navigate"
    ) {
      return c.body(null, 200);
    }
    return html(
      "You won't get Talvra emails",
      `<p>Reminders and digests are off. You can turn them back on anytime in <a href="/reminders">Reminders</a>.</p>`,
      200,
    );
  },
);
