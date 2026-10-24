import { z } from "zod";
import { Id, Timestamp } from "./common.js";

export const CanvasConnection = z.object({
  baseUrl: z.url(),
  status: z.enum(["active", "invalid", "revoked"]),
  /** Only the last 4 characters of the token ever leave the server. */
  tokenLast4: z.string(),
  lastVerifiedAt: Timestamp.nullable(),
});
export type CanvasConnection = z.infer<typeof CanvasConnection>;

export const Me = z.object({
  user: z.object({
    id: Id,
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
  }),
  onboarded: z.boolean(),
  canvas: CanvasConnection.nullable(),
  /** Features switched on for this account by the server (not user-editable). */
  features: z.object({ doHomework: z.boolean() }).default({ doHomework: false }),
});
export type Me = z.infer<typeof Me>;

export const UpdateMe = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
});
export type UpdateMe = z.infer<typeof UpdateMe>;

/** Canvas hosts we will call. Anything else is rejected before any request is made. */
export const CANVAS_HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.instructure\.com$/;
export const DEFAULT_CANVAS_URL = "https://morganstate.instructure.com";

export const ConnectCanvas = z.object({
  baseUrl: z
    .url()
    .default(DEFAULT_CANVAS_URL)
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && url.port === "" && CANVAS_HOST_PATTERN.test(url.hostname);
    }, "Use your school's https://<school>.instructure.com address")
    .transform((u) => new URL(u).origin),
  token: z.string().trim().min(20, "That doesn't look like a Canvas access token").max(200),
});
export type ConnectCanvas = z.input<typeof ConnectCanvas>;

export const ConnectCanvasResult = z.object({
  connection: CanvasConnection,
  canvasUserName: z.string(),
});
export type ConnectCanvasResult = z.infer<typeof ConnectCanvasResult>;

/** A course as Canvas reports it, plus whether the user picked it. */
export const CanvasCourse = z.object({
  canvasId: z.string(),
  name: z.string(),
  courseCode: z.string().nullable(),
  term: z.string().nullable(),
  selected: z.boolean(),
});
export type CanvasCourse = z.infer<typeof CanvasCourse>;

export const CanvasCourseList = z.object({ items: z.array(CanvasCourse) });
export type CanvasCourseList = z.infer<typeof CanvasCourseList>;

export const CourseSelection = z.object({
  canvasIds: z.array(z.string().regex(/^\d+$/)).max(50),
});
export type CourseSelection = z.infer<typeof CourseSelection>;

export const PublicConfig = z.object({
  googleEnabled: z.boolean(),
  allowedEmailDomains: z.array(z.string()),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const DeleteAccount = z.object({
  /** Must equal the account email: a deliberate, typed confirmation. */
  confirm: z.string().trim(),
});
export type DeleteAccount = z.infer<typeof DeleteAccount>;
