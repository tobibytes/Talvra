import type { ApiKey } from "@talvra/contracts";
import { and, type Database, eq, schema, sql } from "@talvra/db";

const { apiKeys } = schema;
export const API_KEY_PREFIX = "tlv_";
export const MAX_API_KEYS = 10;

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Keys are 256 random bits, so a plain SHA-256 is enough (no salt or slow hash needed). */
export async function hashApiKey(secret: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
}

export async function newApiKey(): Promise<{ secret: string; hash: string; last4: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret =
    API_KEY_PREFIX +
    btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (ch) =>
      ch === "+" ? "-" : ch === "/" ? "_" : "",
    );
  return { secret, hash: await hashApiKey(secret), last4: secret.slice(-4) };
}

export const toApiKey = (row: typeof apiKeys.$inferSelect): ApiKey => ({
  id: row.id,
  name: row.name,
  last4: row.keyLast4,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

/** The key's owner, or null. Marks it used (at most once a minute, to spare the database). */
export async function userForApiKey(db: Database, secret: string): Promise<string | null> {
  if (!secret.startsWith(API_KEY_PREFIX) || secret.length > 100) return null;
  const hash = await hashApiKey(secret);
  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(apiKeys.id, row.id), eq(apiKeys.userId, row.userId)));
  }
  return row.userId;
}
