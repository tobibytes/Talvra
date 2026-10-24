import { z } from "zod";
import { Id, Timestamp } from "./common.js";

/** Reminder offsets students can pick (minutes before the due time). */
export const REMINDER_OFFSETS = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 360, label: "6 hours before" },
  { minutes: 180, label: "3 hours before" },
  { minutes: 60, label: "1 hour before" },
] as const;
const ALLOWED = new Set<number>(REMINDER_OFFSETS.map((o) => o.minutes));

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const Hour = z.number().int().min(0).max(23);

export const ReminderPrefs = z.object({
  emailEnabled: z.boolean(),
  offsets: z
    .array(z.number().int())
    .max(REMINDER_OFFSETS.length)
    .refine((xs) => xs.every((x) => ALLOWED.has(x)), "Pick from the listed reminder times"),
  digestEnabled: z.boolean(),
  digestHour: Hour,
  timezone: z.string().refine(validTimeZone, "Unknown time zone"),
  quietStart: Hour,
  quietEnd: Hour,
});
export type ReminderPrefs = z.infer<typeof ReminderPrefs>;

export const UpdateReminderPrefs = ReminderPrefs.partial();
export type UpdateReminderPrefs = z.infer<typeof UpdateReminderPrefs>;

export const NotificationItem = z.object({
  id: Id,
  kind: z.enum(["due_reminder", "digest", "test"]),
  subject: z.string().nullable(),
  status: z.enum(["pending", "sent", "skipped", "failed"]),
  scheduledFor: Timestamp,
  sentAt: Timestamp.nullable(),
  error: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const UpcomingReminder = z.object({
  assignmentId: Id,
  assignmentName: z.string(),
  courseName: z.string(),
  dueAt: Timestamp,
  remindAt: Timestamp,
  offsetMinutes: z.number().int(),
});
export type UpcomingReminder = z.infer<typeof UpcomingReminder>;

export const RemindersOverview = z.object({
  prefs: ReminderPrefs,
  /** What will be sent in the next 7 days with the current settings. */
  upcoming: z.array(UpcomingReminder),
  history: z.array(NotificationItem),
});
export type RemindersOverview = z.infer<typeof RemindersOverview>;
