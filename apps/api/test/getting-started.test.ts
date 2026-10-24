import { GettingStarted } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it } from "vitest";
import { harness, signedInUser } from "./helpers.js";

async function setup() {
  const db = await createTestDb();
  const h = await harness({ db });
  await signedInUser(h);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "student@morgan.edu"));
  if (!user) throw new Error("setup");
  const read = async () =>
    GettingStarted.parse(await (await h.request("/api/v1/me/getting-started")).json());
  return { h, db, userId: user.id, read };
}

describe("getting started checklist", () => {
  it("starts empty and each step flips when the data shows it", async () => {
    const { db, userId, read } = await setup();
    expect(await read()).toEqual({
      steps: { canvas: false, studyAid: false, review: false, ask: false, assistant: false },
      dismissed: false,
    });

    await db.insert(schema.canvasConnections).values({
      userId,
      baseUrl: "https://morganstate.instructure.com",
      tokenCiphertext: new Uint8Array([1]),
      tokenIv: new Uint8Array([2]),
      tokenLast4: "abcd",
    });
    const [doc] = await db
      .insert(schema.documents)
      .values({ userId, source: "upload", title: "Notes.pdf", status: "ready" })
      .returning();
    if (!doc) throw new Error("doc");
    const [aid] = await db
      .insert(schema.studyAids)
      .values({ userId, documentId: doc.id, kind: "flashcards", version: 1, status: "ready" })
      .returning();
    if (!aid) throw new Error("aid");
    expect((await read()).steps).toMatchObject({ canvas: true, studyAid: true, review: false });

    const [card] = await db
      .insert(schema.flashcards)
      .values({
        userId,
        aidId: aid.id,
        documentId: doc.id,
        position: 1,
        front: "Q",
        back: "A",
        cite: [{ kind: "page", n: 1 }],
        due: new Date(),
        stability: 0,
        difficulty: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: 0,
      })
      .returning();
    if (!card) throw new Error("card");
    await db
      .insert(schema.flashcardReviews)
      .values({ userId, flashcardId: card.id, rating: 3, stateBefore: 0, scheduledDays: 1 });
    await db.insert(schema.usageEvents).values({ userId, kind: "basic_ask" });
    await db
      .insert(schema.apiKeys)
      .values({ userId, name: "Claude", keyHash: "h".repeat(64), keyLast4: "abcd" });

    expect((await read()).steps).toEqual({
      canvas: true,
      studyAid: true,
      review: true,
      ask: true,
      assistant: true,
    });
  });

  it("remembers a dismissal, per account", async () => {
    const { h, read } = await setup();
    const res = await h.request("/api/v1/me/getting-started/dismiss", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await read()).dismissed).toBe(true);

    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    expect((await read()).dismissed).toBe(false);
  });

  it("doesn't count another account's activity", async () => {
    const { h, db, userId, read } = await setup();
    await db.insert(schema.usageEvents).values({ userId, kind: "ask" });
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    expect((await read()).steps.ask).toBe(false);
  });

  it("needs sign-in", async () => {
    const { h } = await setup();
    h.clearCookies();
    expect((await h.request("/api/v1/me/getting-started")).status).toBe(401);
  });
});
