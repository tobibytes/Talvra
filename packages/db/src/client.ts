import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

/**
 * On Workers pass the Hyperdrive connection string; locally pass DATABASE_URL.
 * Hyperdrive does the pooling, so keep the client-side pool small.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 5, fetch_types: false, prepare: true });
  return drizzle(client, { schema });
}
