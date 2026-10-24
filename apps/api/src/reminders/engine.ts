import type { NotificationItem, ReminderPrefs, UpcomingReminder } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, or, schema, sql } from "@talvra/db";
import { studySummary } from "../ai/review.js";
import type { SendEmail } from "../lib/email.js";
import { type DueLine, digestEmail, reminderEmail } from "../lib/notify-email.js";
import { afterQuietHours, localParts } from "./time.js";
import { unsubscribeUrl } from "./unsubscribe.js";

const { reminderPrefs, notifications, assignments, courses, users } = schema;

export const DEFAULT_PREFS: ReminderPrefs = {
  emailEnabled: true,
  offsets: [1440, 180],
  digestEnabled: true,
  digestHour: 7,
  timezone: "America/New_York",
  quietStart: 22,
  quietEnd: 7,
};

/** A reminder older than this is no longer useful; skip instead of sending late. */
const STALE_MS = 2 * 3600_000;
const MAX_ATTEMPTS = 3;

export async function getPrefs(db: Database, userId: string): Promise<ReminderPrefs> {
  const [row] = await db
    .select()
    .from(reminderPrefs)
    .where(eq(reminderPrefs.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_PREFS;
  return {
    emailEnabled: row.emailEnabled,
    offsets: row.offsets,
    digestEnabled: row.digestEnabled,
    digestHour: row.digestHour,
    timezone: row.timezone,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
  };
}

export async function savePrefs(db: Database, userId: string, patch: Partial<ReminderPrefs>) {
  const next = { ...(await getPrefs(db, userId)), ...patch };
  next.offsets = [...new Set(next.offsets)].sort((a, b) => b - a);
  await db
    .insert(reminderPrefs)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: reminderPrefs.userId, set: next });
  return next;
}

/** Assignments a student could still be reminded about (open, due in the window). */
async function openAssignmentsDue(db: Database, from: Date, to: Date, userId?: string) {
  return db
    .select({
      userId: assignments.userId,
      assignmentId: assignments.id,
      name: assignments.name,
      courseName: courses.name,
      dueAt: assignments.dueAt,
    })
    .from(assignments)
    .innerJoin(courses, eq(courses.id, assignments.courseId))
    .innerJoin(users, eq(users.id, assignments.userId))
    .where(
      and(
        userId ? eq(assignments.userId, userId) : undefined,
        eq(courses.selected, true),
        eq(assignments.published, true),
        isNotNull(assignments.dueAt),
        gt(assignments.dueAt, from),
        lte(assignments.dueAt, to),
        or(
          sql`${assignments.submissionState} is null`,
          eq(assignments.submissionState, "unsubmitted"),
        ),
        eq(users.emailVerified, true),
        isNotNull(users.onboardedAt),
      ),
    );
}

/** When a reminder at `offset` for this due date should go out (null = not this run). */
function remindAt(dueAt: Date, offset: number, prefs: ReminderPrefs, now: Date) {
  const at = new Date(dueAt.getTime() - offset * 60_000);
  if (at.getTime() > now.getTime() || at.getTime() < now.getTime() - STALE_MS) return null;
  const deferred = afterQuietHours(now, prefs.timezone, prefs.quietStart, prefs.quietEnd);
  // Never defer past the due time: a late-night deadline still gets its reminder.
  return deferred.getTime() < dueAt.getTime() ? deferred : now;
}

/**
 * Cron step 1: plan reminders and digests that are due now. Idempotent: the
 * dedupe key (assignment + offset + due date) means a changed due date gets
 * fresh reminders and re-running never doubles up.
 */
export async function planNotifications(db: Database, now = new Date()) {
  const rows = await openAssignmentsDue(db, now, new Date(now.getTime() + 8 * 86_400_000));
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const prefsRows = userIds.length
    ? await db.select().from(reminderPrefs).where(inArray(reminderPrefs.userId, userIds))
    : [];
  const prefsOf = new Map(
    prefsRows.map((p) => [p.userId, { ...DEFAULT_PREFS, ...p } as ReminderPrefs]),
  );
  const planned: (typeof notifications.$inferInsert)[] = [];
  for (const r of rows) {
    const prefs = prefsOf.get(r.userId) ?? DEFAULT_PREFS;
    if (!prefs.emailEnabled || !r.dueAt) continue;
    for (const offset of prefs.offsets) {
      const at = remindAt(r.dueAt, offset, prefs, now);
      if (!at) continue;
      planned.push({
        userId: r.userId,
        kind: "due_reminder",
        assignmentId: r.assignmentId,
        offsetMinutes: offset,
        dedupeKey: `due:${r.assignmentId}:${offset}:${r.dueAt.toISOString()}`,
        scheduledFor: at,
      });
    }
  }

  // Digest: once per local day at the chosen hour, for everyone who wants one.
  const digestUsers = await db
    .select({ userId: users.id, prefs: reminderPrefs })
    .from(users)
    .leftJoin(reminderPrefs, eq(reminderPrefs.userId, users.id))
    .where(and(eq(users.emailVerified, true), isNotNull(users.onboardedAt)));
  for (const u of digestUsers) {
    const prefs = u.prefs ? ({ ...DEFAULT_PREFS, ...u.prefs } as ReminderPrefs) : DEFAULT_PREFS;
    if (!prefs.emailEnabled || !prefs.digestEnabled) continue;
    const local = localParts(now, prefs.timezone);
    if (local.hour !== prefs.digestHour) continue;
    planned.push({
      userId: u.userId,
      kind: "digest",
      dedupeKey: `digest:${local.ymd}`,
      scheduledFor: now,
    });
  }

  for (let i = 0; i < planned.length; i += 200) {
    await db
      .insert(notifications)
      .values(planned.slice(i, i + 200))
      .onConflictDoNothing();
  }
  return planned.length;
}

export type SendDeps = { db: Database; send: SendEmail; appUrl: string; secret: string };

/** Cron step 2: send what's due. Re-checks each reminder so submitted work is skipped. */
export async function sendPending(deps: SendDeps, now = new Date(), limit = 100) {
  const { db, appUrl } = deps;
  const due = await db
    .select({ n: notifications, email: users.email, name: users.name })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notifications.status, "pending"), lte(notifications.scheduledFor, now)))
    .orderBy(asc(notifications.scheduledFor))
    .limit(limit);
  let sent = 0;
  for (const { n, email, name } of due) {
    const mark = (patch: Partial<typeof notifications.$inferInsert>) =>
      db.update(notifications).set(patch).where(eq(notifications.id, n.id));
    try {
      const prefs = await getPrefs(db, n.userId);
      if (!prefs.emailEnabled && n.kind !== "test") {
        await mark({ status: "skipped", error: "Emails are turned off." });
        continue;
      }
      const unsub = await unsubscribeUrl(appUrl, deps.secret, n.userId);
      let message: Parameters<SendEmail>[0] | null = null;
      if (n.kind === "due_reminder" && n.assignmentId) {
        const [a] = await openAssignmentsDue(
          db,
          now,
          new Date(now.getTime() + 30 * 86_400_000),
          n.userId,
        ).then((rows) => rows.filter((r) => r.assignmentId === n.assignmentId));
        if (!a?.dueAt) {
          await mark({ status: "skipped", error: "Submitted, no longer due, or removed." });
          continue;
        }
        message = reminderEmail({
          to: email,
          name: a.name,
          course: a.courseName,
          dueAt: a.dueAt,
          timeZone: prefs.timezone,
          url: `${appUrl}/homework/${a.assignmentId}`,
          unsubscribeUrl: unsub,
          now,
        });
      } else if (n.kind === "digest") {
        message = await buildDigest(db, n.userId, { to: email, name, prefs, appUrl, unsub, now });
        if (!message) {
          await mark({ status: "skipped", error: "Nothing due." });
          continue;
        }
      }
      if (!message) {
        await mark({ status: "skipped", error: "Nothing to send." });
        continue;
      }
      await deps.send(message);
      await mark({
        status: "sent",
        sentAt: new Date(),
        subject: message.subject,
        attempts: n.attempts + 1,
      });
      sent++;
    } catch (err) {
      const attempts = n.attempts + 1;
      await mark({
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        error: String(err).slice(0, 300),
      });
    }
  }
  return sent;
}

async function buildDigest(
  db: Database,
  userId: string,
  o: { to: string; name: string; prefs: ReminderPrefs; appUrl: string; unsub: string; now: Date },
) {
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: o.prefs.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  const line = (r: {
    assignmentId: string;
    name: string;
    courseName: string;
    dueAt: Date | null;
  }): DueLine => ({
    name: r.name,
    course: r.courseName,
    due: r.dueAt ? fmt(r.dueAt) : "no date",
    url: `${o.appUrl}/homework/${r.assignmentId}`,
  });
  const soon = await openAssignmentsDue(
    db,
    o.now,
    new Date(o.now.getTime() + 2 * 86_400_000),
    userId,
  );
  const overdue = await openAssignmentsDue(
    db,
    new Date(o.now.getTime() - 7 * 86_400_000),
    o.now,
    userId,
  );
  const { dueNow } = await studySummary(db, userId, o.now);
  if (!soon.length && !overdue.length && !dueNow) return null;
  return digestEmail({
    to: o.to,
    firstName: o.name.split(" ")[0] ?? o.name,
    overdue: overdue.map(line),
    dueSoon: soon.map(line),
    cardsDue: dueNow,
    appUrl: o.appUrl,
    unsubscribeUrl: o.unsub,
  });
}

/** What will be sent in the next 7 days with the given settings (for the Reminders page). */
export async function upcomingReminders(
  db: Database,
  userId: string,
  prefs: ReminderPrefs,
  now = new Date(),
) {
  if (!prefs.emailEnabled) return [];
  const rows = await openAssignmentsDue(db, now, new Date(now.getTime() + 15 * 86_400_000), userId);
  const horizon = now.getTime() + 7 * 86_400_000;
  const out: UpcomingReminder[] = [];
  for (const r of rows) {
    if (!r.dueAt) continue;
    for (const offset of prefs.offsets) {
      const raw = new Date(r.dueAt.getTime() - offset * 60_000);
      if (raw.getTime() < now.getTime() || raw.getTime() > horizon) continue;
      const at = afterQuietHours(raw, prefs.timezone, prefs.quietStart, prefs.quietEnd);
      out.push({
        assignmentId: r.assignmentId,
        assignmentName: r.name,
        courseName: r.courseName,
        dueAt: r.dueAt.toISOString(),
        remindAt: (at.getTime() < r.dueAt.getTime() ? at : raw).toISOString(),
        offsetMinutes: offset,
      });
    }
  }
  return out.sort((a, b) => a.remindAt.localeCompare(b.remindAt)).slice(0, 30);
}

export async function history(db: Database, userId: string): Promise<NotificationItem[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  return rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    subject: n.subject,
    status: n.status,
    scheduledFor: n.scheduledFor.toISOString(),
    sentAt: n.sentAt?.toISOString() ?? null,
    error: n.status === "failed" ? "Couldn't send." : n.status === "skipped" ? n.error : null,
  }));
}
