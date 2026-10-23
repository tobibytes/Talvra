import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./api";

afterEach(() => vi.restoreAllMocks());

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("api client", () => {
  it("parses a valid response", async () => {
    respond(200, { status: "ok", version: "1", checks: { database: "ok" } });
    await expect(api.health()).resolves.toMatchObject({ status: "ok" });
  });

  it("surfaces the server error envelope", async () => {
    respond(401, {
      error: { code: "unauthorized", message: "Sign in to continue.", requestId: "req_1" },
    });
    const err = await api.courses().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).message).toBe("Sign in to continue.");
    expect((err as ApiRequestError).requestId).toBe("req_1");
  });

  it("rejects responses that drift from the contract", async () => {
    respond(200, { status: "fine" });
    await expect(api.health()).rejects.toThrow();
  });
});
