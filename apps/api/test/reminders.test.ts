import { ApiError, RemindersOverview } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import type { Email } from "../src/lib/email.js";
import { planNotifications, savePrefs, sendPending } from "../src/reminders/engine.js";
import { afterQuietHours, inQuietHours, localParts } from "../src/reminders/time.js";
import { unsubscribeUrl, verifyUnsubscribe } from "../src/reminders/unsubscribe.js";
import { APP_URL, env, harness, signedInUser } from "./helpers.js";

const H = 3600_000;
// 2026-10-23 14:00 in New York (EDT, UTC-4).
const NOON_ISH = new Date("2026-10-23T18:00:00Z");

async function setup() {
  const db = await createTestDb();
  const h = await harness({ db });
  await signedInUser(h);
  const [user] = await db.select().from(schema.users);
  if (!user) throw new Error("setup");
  await db.update(schema.users).set({ onboardedAt: new Date() });
  const [course] = await db
    .insert(schema.courses)
    .values({ userId: user.id, canvasId: "101", name: "COSC 220", selected: true })
    .returning();
  const addAssignment = async (
    name: string,
    dueAt: Date,
    extra: Partial<typeof schema.assignments.$inferInsert> = {},
  ) => {
    const [a] = await db
      .insert(schema.assignments)
      .values({
        userId: user.id,
        courseId: course?.id ?? "",
        canvasId: name,
        name,
        dueAt,
        ...extra,
      })
      .returning();
    if (!a) throw new Error("insert");
    return a;
  };
  const sent: Email[] = [];
  const deps = {
    db,
    send: async (e: Email) => void sent.push(e),
    appUrl: APP_URL,
    secret: env.BETTER_AUTH_SECRET,
  };
  return { h, db, user, addAssignment, sent, deps };
}

describe("time", () => {
  it("reads local time in any zone and handles quiet hours across midnight", () => {
    expect(localParts(NOON_ISH, "America/New_York")).toEqual({ ymd: "2026-10-23", hour: 14 });
    expect(localParts(NOON_ISH, "Africa/Lagos")).toEqual({ ymd: "2026-10-23", hour: 19 });
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(6, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(3, 5, 5)).toBe(false);
    // 23:30 local → the next 07:00 local.
    const late = new Date("2026-10-24T03:30:00Z");
    const after = afterQuietHours(late, "America/New_York", 22, 7);
    expect(localParts(after, "America/New_York")).toEqual({ ymd: "2026-10-24", hour: 7 });
  });

  it("makes tamper-proof unsubscribe links", async () => {
    const url = await unsubscribeUrl(
      "https://talvra.app",
      "secret",
      "0b8f6c3e-6a0a-4b6a-9c43-2f1f4e1a8c11",
    );
    const token = new URL(url).searchParams.get("token") ?? "";
    expect(await verifyUnsubscribe("secret", token)).toBe("0b8f6c3e-6a0a-4b6a-9c43-2f1f4e1a8c11");
    expect(await verifyUnsubscribe("other-secret", token)).toBeNull();
    expect(await verifyUnsubscribe("secret", token.replace(/^0/, "1"))).toBeNull();
    expect(await verifyUnsubscribe("secret", "garbage")).toBeNull();
  });
});

describe("planning", () => {
  it("plans each reminder once, at the right offsets, and re-arms when the due date moves", async () => {
    const { db, addAssignment } = await setup();
    const a = await addAssignment("Lab 2", new Date(NOON_ISH.getTime() + 24 * H - 10 * 60_000)); // 1-day mark just passed
    await addAssignment("Far away", new Date(NOON_ISH.getTime() + 5 * 86_400_000));
    expect(await planNotifications(db, NOON_ISH)).toBe(1);
    await planNotifications(db, NOON_ISH);
    let rows = await db.select().from(schema.notifications);
    expect(rows.map((r) => [r.kind, r.offsetMinutes])).toEqual([["due_reminder", 1440]]);

    await db
      .update(schema.assignments)
      .set({ dueAt: new Date(NOON_ISH.getTime() + 24 * H - 20 * 60_000) })
      .where(eq(schema.assignments.id, a.id));
    await planNotifications(db, NOON_ISH);
    rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(2);
  });

  it("skips submitted work, stale reminders, unverified accounts and people who opted out", async () => {
    const { db, addAssignment, user } = await setup();
    await addAssignment("Submitted", new Date(NOON_ISH.getTime() + 2 * H + 50 * 60_000), {
      submissionState: "submitted",
    });
    await addAssignment("Stale", new Date(NOON_ISH.getTime() + 24 * H - 5 * H)); // 1-day mark was 5h ago
    expect(await planNotifications(db, NOON_ISH)).toBe(0);
    await addAssignment("Real", new Date(NOON_ISH.getTime() + 2 * H + 50 * 60_000)); // 3-hour mark passed
    await savePrefs(db, user.id, { emailEnabled: false });
    expect(await planNotifications(db, NOON_ISH)).toBe(0);
    await savePrefs(db, user.id, { emailEnabled: true });
    await db.update(schema.users).set({ emailVerified: false });
    expect(await planNotifications(db, NOON_ISH)).toBe(0);
  });

  it("holds reminders during quiet hours, unless the deadline comes first", async () => {
    const { db, addAssignment } = await setup();
    const night = new Date("2026-10-24T03:30:00Z"); // 23:30 New York
    await addAssignment("Morning deadline", new Date(night.getTime() + 24 * H - 10 * 60_000));
    await addAssignment("Midnight deadline", new Date(night.getTime() + 3 * H - 10 * 60_000));
    await planNotifications(db, night);
    const rows = await db.select().from(schema.notifications);
    const local = rows
      .map((r) => localParts(r.scheduledFor, "America/New_York").hour)
      .sort((a, b) => a - b);
    expect(local).toEqual([7, 23]); // deferred to 07:00, and the midnight one goes now
  });

  it("plans one digest per local day at the chosen hour", async () => {
    const { db, user } = await setup();
    await savePrefs(db, user.id, { digestHour: 14 });
    await planNotifications(db, NOON_ISH);
    await planNotifications(db, new Date(NOON_ISH.getTime() + 20 * 60_000));
    await planNotifications(db, new Date(NOON_ISH.getTime() + 2 * H));
    const digests = (await db.select().from(schema.notifications)).filter(
      (n) => n.kind === "digest",
    );
    expect(digests.map((d) => d.dedupeKey)).toEqual(["digest:2026-10-23"]);
  });
});

describe("sending", () => {
  it("sends reminders with a link to the plan and one-click unsubscribe", async () => {
    const { db, addAssignment, sent, deps } = await setup();
    const a = await addAssignment("Lab 2", new Date(NOON_ISH.getTime() + 2 * H + 50 * 60_000));
    await planNotifications(db, NOON_ISH);
    expect(await sendPending(deps, NOON_ISH)).toBe(1);
    expect(sent[0]?.subject).toBe("Due in 3 hours: Lab 2");
    expect(sent[0]?.text).toContain(`${APP_URL}/homework/${a.id}`);
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toMatch(/\/api\/unsubscribe\?token=/);
    expect(sent[0]?.html).not.toContain("<script");
    const [n] = await db.select().from(schema.notifications);
    expect(n).toMatchObject({ status: "sent", subject: "Due in 3 hours: Lab 2" });
    expect(await sendPending(deps, NOON_ISH)).toBe(0);
  });

  it("skips a reminder if the work was submitted in the meantime", async () => {
    const { db, addAssignment, sent, deps } = await setup();
    const a = await addAssignment("Lab 2", new Date(NOON_ISH.getTime() + 2 * H + 50 * 60_000));
    await planNotifications(db, NOON_ISH);
    await db
      .update(schema.assignments)
      .set({ submissionState: "submitted" })
      .where(eq(schema.assignments.id, a.id));
    await sendPending(deps, NOON_ISH);
    expect(sent).toHaveLength(0);
    expect((await db.select().from(schema.notifications))[0]?.status).toBe("skipped");
  });

  it("sends a digest only when there's something in it", async () => {
    const { db, user, addAssignment, sent, deps } = await setup();
    await savePrefs(db, user.id, { digestHour: 14 });
    await planNotifications(db, NOON_ISH);
    await sendPending(deps, NOON_ISH);
    expect(sent).toHaveLength(0);
    await addAssignment("Essay", new Date(NOON_ISH.getTime() + 30 * H));
    await addAssignment("Quiz", new Date(NOON_ISH.getTime() - 5 * H));
    await planNotifications(db, new Date(NOON_ISH.getTime() + 86_400_000));
    await sendPending(deps, new Date(NOON_ISH.getTime() + 86_400_000));
    // Next day at 14:00: Quiz is overdue, Essay is due in 6 hours.
    const digest = sent.find((e) => e.subject.startsWith("Today:"));
    expect(digest?.subject).toBe("Today: 2 things due soon (1 overdue)");
    expect(digest?.text).toMatch(/Overdue\n- Quiz/);
    expect(digest?.text).toMatch(/Due in the next 2 days\n- Essay/);
  });

  it("retries a failed send, then gives up", async () => {
    const { db, addAssignment, deps } = await setup();
    await addAssignment("Lab 2", new Date(NOON_ISH.getTime() + 2 * H + 50 * 60_000));
    await planNotifications(db, NOON_ISH);
    const failing = { ...deps, send: vi.fn(async () => Promise.reject(new Error("smtp down"))) };
    await sendPending(failing, NOON_ISH);
    await sendPending(failing, NOON_ISH);
    expect((await db.select().from(schema.notifications))[0]?.status).toBe("pending");
    await sendPending(failing, NOON_ISH);
    expect((await db.select().from(schema.notifications))[0]).toMatchObject({
      status: "failed",
      attempts: 3,
    });
  });
});

describe("reminders API", () => {
  it("shows defaults and what's coming, and saves validated changes", async () => {
    const { h, addAssignment } = await setup();
    await addAssignment("Essay", new Date(Date.now() + 3 * 86_400_000));
    let o = RemindersOverview.parse(await (await h.request("/api/v1/reminders")).json());
    expect(o.prefs).toMatchObject({ emailEnabled: true, offsets: [1440, 180], digestHour: 7 });
    expect(o.upcoming.map((u) => u.offsetMinutes)).toEqual([1440, 180]);
    const res = await h.request("/api/v1/reminders/prefs", {
      method: "PUT",
      json: { offsets: [60, 4320, 60], timezone: "Africa/Lagos" },
    });
    o = RemindersOverview.parse(await res.json());
    expect(o.prefs).toMatchObject({ offsets: [4320, 60], timezone: "Africa/Lagos" });
    for (const bad of [{ offsets: [7] }, { timezone: "Mars/Olympus" }, { digestHour: 24 }]) {
      expect(
        (await h.request("/api/v1/reminders/prefs", { method: "PUT", json: bad })).status,
      ).toBe(422);
    }
  });

  it("sends a test email, with a limit", async () => {
    const { h } = await setup();
    for (let i = 0; i < 3; i++) {
      expect((await h.request("/api/v1/reminders/test", { method: "POST" })).status).toBe(200);
    }
    expect(h.emails.at(-1)?.subject).toBe("Talvra reminders are working");
    const res = await h.request("/api/v1/reminders/test", { method: "POST" });
    expect(res.status).toBe(429);
    expect(ApiError.parse(await res.json()).error.code).toBe("rate_limited");
    const o = RemindersOverview.parse(await (await h.request("/api/v1/reminders")).json());
    expect(o.history.filter((n) => n.kind === "test")).toHaveLength(3);
  });

  it("unsubscribes from a signed link without signing in", async () => {
    const { h, db, user } = await setup();
    const url = new URL(await unsubscribeUrl(APP_URL, env.BETTER_AUTH_SECRET, user.id));
    h.clearCookies();
    const res = await h.request(url.pathname + url.search);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You won't get Talvra emails");
    const [prefs] = await db.select().from(schema.reminderPrefs);
    expect(prefs?.emailEnabled).toBe(false);
    expect((await h.request("/api/unsubscribe?token=nope")).status).toBe(400);
    expect((await h.request(url.pathname + url.search, { method: "POST" })).status).toBe(200);
  });
});
