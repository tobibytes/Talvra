import { describe, expect, it, vi } from "vitest";
import { frontDoor } from "../src/front.js";

describe("front door", () => {
  const api = vi.fn(async () => new Response("api"));
  const assets = { fetch: vi.fn(async () => new Response("spa")) };

  it("redirects www to the bare domain, keeping the path and query", async () => {
    const res = await frontDoor(api, assets, new Request("https://www.hwrk.help/review?x=1"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://hwrk.help/review?x=1");
  });

  it("sends /api to the app and everything else to the SPA", async () => {
    expect(
      await (await frontDoor(api, assets, new Request("https://hwrk.help/api/health"))).text(),
    ).toBe("api");
    expect(
      await (await frontDoor(api, assets, new Request("https://hwrk.help/courses"))).text(),
    ).toBe("spa");
    expect(
      await (await frontDoor(api, assets, new Request("https://hwrk.help/apiary"))).text(),
    ).toBe("spa");
  });
});
