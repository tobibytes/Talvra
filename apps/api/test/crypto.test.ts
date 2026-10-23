import { describe, expect, it } from "vitest";
import { parseNextLink } from "../src/lib/canvas.js";
import { decryptSecret, encryptSecret } from "../src/lib/crypto.js";
import { env } from "./helpers.js";

describe("encryptSecret", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptSecret(env.CANVAS_TOKEN_KEY, "secret-token", "user-1");
    const b = await encryptSecret(env.CANVAS_TOKEN_KEY, "secret-token", "user-1");
    expect(a.iv).not.toEqual(b.iv);
    expect(await decryptSecret(env.CANVAS_TOKEN_KEY, a, "user-1")).toBe("secret-token");
  });

  it("is bound to the user id", async () => {
    const a = await encryptSecret(env.CANVAS_TOKEN_KEY, "secret-token", "user-1");
    await expect(decryptSecret(env.CANVAS_TOKEN_KEY, a, "user-2")).rejects.toThrow();
  });

  it("rejects a key of the wrong size", async () => {
    await expect(encryptSecret(btoa("short"), "x", "u")).rejects.toThrow(/32 bytes/);
  });
});

describe("parseNextLink", () => {
  it("finds rel=next among several links", () => {
    const header =
      '<https://x.instructure.com/api/v1/courses?page=1>; rel="current", <https://x.instructure.com/api/v1/courses?page=2>; rel="next"';
    expect(parseNextLink(header)).toBe("https://x.instructure.com/api/v1/courses?page=2");
    expect(parseNextLink(null)).toBeNull();
  });
});
