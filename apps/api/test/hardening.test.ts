import { ApiError } from "@talvra/contracts";
import { describe, expect, it } from "vitest";
import { harness, signedInUser } from "./helpers.js";

/** Fixed-window fake of the Cloudflare rate limit binding. */
function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  return {
    keys: counts,
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

describe("rate limits", () => {
  it("limits sign-in attempts per IP", async () => {
    const RL_AUTH = fakeLimiter(3);
    const h = await harness({ limits: { RL_AUTH } });
    const attempt = () =>
      h.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.7" },
        json: { email: "nobody@morgan.edu", password: "wrong password here" },
      });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).not.toBe(429);
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(ApiError.parse(await res.json()).error.code).toBe("rate_limited");
    expect([...RL_AUTH.keys.keys()]).toEqual(["RL_AUTH:203.0.113.7"]);
  });

  it("limits expensive actions per user, separately from normal browsing", async () => {
    const RL_HEAVY = fakeLimiter(2);
    const RL_API = fakeLimiter(1000);
    const h = await harness({ limits: { RL_HEAVY, RL_API } });
    await signedInUser(h);
    // An empty upload is a 422 until the limiter steps in.
    const upload = () => h.request("/api/v1/documents", { method: "POST", body: new FormData() });
    expect((await upload()).status).toBe(422);
    expect((await upload()).status).toBe(422);
    expect((await upload()).status).toBe(429);
    expect((await h.request("/api/v1/me")).status).toBe(200);
    const keys = [...RL_HEAVY.keys.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^RL_HEAVY:[0-9a-f-]{36}$/);
  });
});

describe("account data", () => {
  async function withData() {
    const { createTestDb } = await import("@talvra/db/testing");
    const { schema } = await import("@talvra/db");
    const { fakeR2 } = await import("./fake-r2.js");
    const db = await createTestDb();
    const r2 = fakeR2();
    const h = await harness({ db, documents: { files: r2.store } });
    await signedInUser(h);
    const [user] = await db.select().from(schema.users);
    const userId = user?.id ?? "";
    await db
      .insert(schema.courses)
      .values({ userId, canvasId: "1", name: "COSC 220", selected: true });
    await db.insert(schema.canvasConnections).values({
      userId,
      baseUrl: "https://morgan.instructure.com",
      tokenCiphertext: new Uint8Array([1, 2, 3]),
      tokenIv: new Uint8Array([4]),
      tokenLast4: "abcd",
    });
    await r2.store.put(`u/${userId}/d/x/original`, "secret notes");
    await r2.store.put("u/someone-else/d/y/original", "theirs");
    return { h, db, r2, userId, schema };
  }

  it("exports everything except secrets", async () => {
    const { h } = await withData();
    const res = await h.request("/api/v1/me/export");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="talvra-export-/);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.user.email).toBe("student@morgan.edu");
    expect(data.courses.map((c: { name: string }) => c.name)).toEqual(["COSC 220"]);
    expect(data.canvas).toEqual({
      baseUrl: "https://morgan.instructure.com",
      status: "active",
      tokenLast4: "abcd",
    });
    expect(text).not.toMatch(/tokenCiphertext|password|session/i);
  });

  it("deletes the account, its files and its sessions after a typed confirmation", async () => {
    const { h, db, r2, schema } = await withData();
    const wrong = await h.request("/api/v1/me", { method: "DELETE", json: { confirm: "nope" } });
    expect(wrong.status).toBe(422);
    const res = await h.request("/api/v1/me", {
      method: "DELETE",
      json: { confirm: "Student@Morgan.edu" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((c) => /session_token=;.*Max-Age=0/.test(c))).toBe(true);
    expect(await db.select().from(schema.users)).toEqual([]);
    expect(await db.select().from(schema.courses)).toEqual([]);
    expect(await db.select().from(schema.sessions)).toEqual([]);
    expect([...r2.objects.keys()]).toEqual(["u/someone-else/d/y/original"]);
    expect((await h.request("/api/v1/me")).status).toBe(401);
  });
});

describe("cross-site requests", () => {
  it("refuses state changes from another origin, allows the app's own", async () => {
    const h = await harness();
    await signedInUser(h);
    const evil = await h.request("/api/v1/me", {
      method: "PATCH",
      headers: { origin: "https://evil.example" },
      json: { name: "Pwned" },
    });
    expect(evil.status).toBe(403);
    const site = await h.request("/api/v1/me", {
      method: "PATCH",
      headers: { origin: "", "sec-fetch-site": "cross-site" },
      json: { name: "Pwned" },
    });
    expect(site.status).toBe(403);
    expect(
      (await h.request("/api/v1/me", { method: "PATCH", json: { name: "Real Name" } })).status,
    ).toBe(200);
  });
});
