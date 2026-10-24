// Re-exported so every package uses this package's drizzle-orm instance.
// (Two copies, e.g. via better-auth's peer deps, don't type-check together.)
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
  sql,
} from "drizzle-orm";
export { createDb, type Database } from "./client.js";
export * as schema from "./schema.js";
