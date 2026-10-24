import type { Database } from "@talvra/db";
import { and, eq, gt, schema, sql } from "@talvra/db";
import { AppError } from "./errors.js";

const { usageEvents } = schema;

export const DAY = 86_400_000;

/**
 * Counts one use of `kind` and refuses when over `limit` within `windowMs`.
 * Inserts first, then counts, so parallel requests can't slip past the limit
 * (a refused attempt is removed again so it doesn't count).
 */
export async function meter(
  db: Database,
  userId: string,
  kind: string,
  { limit, windowMs = DAY, message }: { limit: number; windowMs?: number; message: string },
) {
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
    throw new AppError("rate_limited", message);
  }
}
