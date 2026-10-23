import { ApiError, CourseList, Health } from "@talvra/contracts";
import { type Database, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "./helpers.js";

let db: Database;
let alice = "";
let bob = "";

beforeAll(async () => {
  db = await createTestDb();
  const [a, b] = await db
    .insert(schema.users)
    .values([
      { email: "alice@morgan.edu", name: "Alice" },
      { email: "bob@morgan.edu", name: "Bob" },
    ])
    .returning();
  alice = a?.id ?? "";
  bob = b?.id ?? "";
  await db.insert(schema.courses).values([
    { userId: alice, canvasId: "1", name: "COSC 220 Data Structures", selected: true },
    { userId: alice, canvasId: "2", name: "MATH 241 Calculus I" },
    { userId: alice, canvasId: "3", name: "ENGL 101" },
    { userId: bob, canvasId: "1", name: "Bob's private course" },
  ]);
});

describe("api", () => {
  it("reports health with a database check", async () => {
    const res = await createApp({ db }).request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(Health.parse(await res.json()).checks.database).toBe("ok");
  });

  it("mints a request id, or reuses a valid incoming one", async () => {
    const app = createApp({ db });
    const minted = await app.request("/api/health", {}, env);
    expect(minted.headers.get("x-request-id")).toMatch(/^req_/);
    const reused = await app.request(
      "/api/health",
      { headers: { "x-request-id": "cf-ray-12345678" } },
      env,
    );
    expect(reused.headers.get("x-request-id")).toBe("cf-ray-12345678");
    const junk = await app.request("/api/health", { headers: { "x-request-id": "<script>" } }, env);
    expect(junk.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("returns 401 in the standard envelope when signed out", async () => {
    const res = await createApp({ db }).request("/api/v1/courses", {}, env);
    expect(res.status).toBe(401);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("only returns the signed-in user's courses, paginated", async () => {
    const app = createApp({ db, userId: alice });
    const first = CourseList.parse(
      await (await app.request("/api/v1/courses?limit=2", {}, env)).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = CourseList.parse(
      await (
        await app.request(`/api/v1/courses?limit=2&cursor=${first.nextCursor}`, {}, env)
      ).json(),
    );
    const names = [...first.items, ...second.items].map((c) => c.name);
    expect(names).toHaveLength(3);
    expect(names).not.toContain("Bob's private course");
    expect(second.nextCursor).toBeNull();
  });

  it("rejects bad query params with validation_failed", async () => {
    const res = await createApp({ db, userId: alice }).request(
      "/api/v1/courses?limit=999",
      {},
      env,
    );
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details?.[0]?.path).toBe("limit");
  });

  it("returns not_found for unknown routes", async () => {
    const res = await createApp({ db }).request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
  });

  it("serves an OpenAPI document", async () => {
    const res = await createApp({ db }).request("/api/openapi.json", {}, env);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/health",
        "/api/v1/courses",
        "/api/v1/me",
        "/api/v1/canvas/connection",
      ]),
    );
  });

  it("exposes public config for the sign-in screen", async () => {
    const res = await createApp({ db }).request("/api/config", {}, env);
    expect(await res.json()).toEqual({ googleEnabled: false, allowedEmailDomains: ["morgan.edu"] });
  });
});
