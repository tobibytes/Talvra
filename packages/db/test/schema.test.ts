import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.js";

const { users, courses, documents } = schema;
const db = drizzle(new PGlite(), { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
});

async function makeUser(email: string) {
  const [u] = await db.insert(users).values({ email, name: email }).returning();
  if (!u) throw new Error("insert failed");
  return u;
}

describe("schema", () => {
  it("applies migrations and scopes rows by user", async () => {
    const a = await makeUser("a@morgan.edu");
    const b = await makeUser("b@morgan.edu");
    await db.insert(courses).values([
      { userId: a.id, canvasId: "100", name: "COSC 220" },
      { userId: b.id, canvasId: "100", name: "COSC 220" },
    ]);
    const mine = await db.select().from(courses).where(eq(courses.userId, a.id));
    expect(mine).toHaveLength(1);
  });

  it("treats emails case-insensitively", async () => {
    await makeUser("Case@morgan.edu");
    await expect(makeUser("case@MORGAN.edu")).rejects.toThrow();
  });

  it("dedupes documents per user, not across users", async () => {
    const a = await makeUser("c@morgan.edu");
    const b = await makeUser("d@morgan.edu");
    const doc = { source: "canvas_file" as const, canvasId: "f1", title: "Syllabus" };
    await db.insert(documents).values({ ...doc, userId: a.id });
    await db.insert(documents).values({ ...doc, userId: b.id });
    await expect(db.insert(documents).values({ ...doc, userId: a.id })).rejects.toThrow();
  });

  it("cascades user deletion to owned rows", async () => {
    const u = await makeUser("e@morgan.edu");
    await db.insert(courses).values({ userId: u.id, canvasId: "1", name: "MATH 241" });
    await db.delete(users).where(eq(users.id, u.id));
    const left = await db
      .select()
      .from(courses)
      .where(and(eq(courses.userId, u.id), eq(courses.canvasId, "1")));
    expect(left).toHaveLength(0);
  });
});

describe("ownership integrity", () => {
  it("blocks a row from pointing at another user's course", async () => {
    const a = await makeUser("f@morgan.edu");
    const b = await makeUser("g@morgan.edu");
    const [course] = await db
      .insert(courses)
      .values({ userId: a.id, canvasId: "9", name: "PHYS 205" })
      .returning();
    await expect(
      db.insert(schema.assignments).values({
        userId: b.id,
        courseId: course?.id ?? "",
        canvasId: "a1",
        name: "Lab 1",
      }),
    ).rejects.toThrow();
  });
});
