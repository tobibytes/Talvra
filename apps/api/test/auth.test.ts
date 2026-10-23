import { Me } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.js";
import { env, harness, signedInUser } from "./helpers.js";

describe("auth", () => {
  it("only lets @morgan.edu emails sign up", async () => {
    const h = await harness();
    const res = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      json: { email: "someone@gmail.com", password: "correct horse battery", name: "Nope" },
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("@morgan.edu");
    expect(h.emails).toHaveLength(0);
    const rows = await h.db.select().from(schema.users);
    expect(rows).toHaveLength(0);
  });

  it("blocks non-school emails in the database hook too (covers Google sign-up)", async () => {
    const h = await harness();
    const auth = createAuth(env, h.db, async () => {});
    await auth.api
      .signUpEmail({ body: { email: "x@yahoo.com", password: "correct horse battery", name: "X" } })
      .catch(() => {});
    expect(await h.db.select().from(schema.users)).toHaveLength(0);
  });

  it("requires email verification before signing in", async () => {
    const h = await harness();
    const signup = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      json: { email: "new@morgan.edu", password: "correct horse battery", name: "New Student" },
    });
    expect(signup.status).toBe(200);
    expect(h.emails[0]?.subject).toContain("Confirm your email");

    h.clearCookies();
    const early = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      json: { email: "new@morgan.edu", password: "correct horse battery" },
    });
    expect(early.status).toBe(403);
    expect((await h.request("/api/v1/me")).status).toBe(401);

    // Clicking the emailed link verifies and signs in.
    const verify = await h.request(h.lastEmailLink());
    expect(verify.status).toBeLessThan(400);
    const me = Me.parse(await (await h.request("/api/v1/me")).json());
    expect(me.user.email).toBe("new@morgan.edu");
    expect(me.user.emailVerified).toBe(true);
    expect(me.onboarded).toBe(false);
    expect(me.canvas).toBeNull();
  });

  it("enforces a minimum password length", async () => {
    const h = await harness();
    const res = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      json: { email: "short@morgan.edu", password: "short", name: "Short" },
    });
    expect(res.status).toBe(400);
  });

  it("stores sessions in Postgres with an expiry, and signs out", async () => {
    const h = await harness();
    await signedInUser(h);
    const [session] = await h.db.select().from(schema.sessions);
    expect(session).toBeDefined();
    const days = ((session?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThanOrEqual(14);

    const out = await h.request("/api/auth/sign-out", { method: "POST", json: {} });
    expect(out.status).toBe(200);
    expect((await h.request("/api/v1/me")).status).toBe(401);
    expect(await h.db.select().from(schema.sessions)).toHaveLength(0);
  });

  it("rejects a wrong password without revealing whether the email exists", async () => {
    const h = await harness();
    const { email } = await signedInUser(h);
    h.clearCookies();
    const wrong = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      json: { email, password: "not the password at all" },
    });
    const unknown = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      json: { email: "ghost@morgan.edu", password: "not the password at all" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it("updates the profile name and validates it", async () => {
    const h = await harness();
    await signedInUser(h);
    const ok = await h.request("/api/v1/me", { method: "PATCH", json: { name: "  Tobi  " } });
    expect(Me.parse(await ok.json()).user.name).toBe("Tobi");
    const bad = await h.request("/api/v1/me", { method: "PATCH", json: { name: "" } });
    expect(bad.status).toBe(422);
  });

  it("won't finish onboarding until Canvas is connected", async () => {
    const h = await harness();
    await signedInUser(h);
    const res = await h.request("/api/v1/me/onboarding/complete", { method: "POST" });
    expect(res.status).toBe(409);
    const [user] = await h.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "student@morgan.edu"));
    expect(user?.onboardedAt).toBeNull();
  });
});
