import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "./client.js";
import * as schema from "./schema.js";

/**
 * In-memory Postgres (PGlite) with every migration applied. Test-only.
 * PGlite and postgres-js share Drizzle's query API; only the driver differs.
 */
export async function createTestDb(): Promise<Database> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  return db as unknown as Database;
}
