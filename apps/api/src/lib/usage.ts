import type { Database } from "@talvra/db";
import { and, eq, gt, schema, sql } from "@talvra/db";
import { AppError } from "./errors.js";

const { usageEvents } = schema;

export const DAY = 86_400_000;

/**
 * Counts one use of `kind` if it's within `limit` per `windowMs`; returns
 * whether it was allowed. Inserts first, then counts, so parallel requests
 * can't slip past the limit (a refused attempt is removed again).
 */
export async function tryMeter(
  db: Database,
  userId: string,
  kind: string,
  { limit, windowMs = DAY }: { limit: number; windowMs?: number },
): Promise<boolean> {
  const [row] = await db
    .insert(usageEvents)
    .values({ userId, kind })
    .returning({ id: usageEvents.id });
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.kind, kind),
        gt(usageEvents.createdAt, new Date(Date.now() - windowMs)),
      ),
    );
  if (n > limit) {
    if (row) await db.delete(usageEvents).where(eq(usageEvents.id, row.id));
    return false;
  }
  return true;
}

/** Like tryMeter, but refuses with a rate_limited error when over the limit. */
export async function meter(
  db: Database,
  userId: string,
  kind: string,
  { limit, windowMs = DAY, message }: { limit: number; windowMs?: number; message: string },
) {
  if (!(await tryMeter(db, userId, kind, { limit, windowMs })))
    throw new AppError("rate_limited", message);
}

/** Uses of `kind` in the window, without counting a new one. */
export async function usedToday(db: Database, userId: string, kind: string, windowMs = DAY) {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.kind, kind),
        gt(usageEvents.createdAt, new Date(Date.now() - windowMs)),
      ),
    );
  return n;
}
