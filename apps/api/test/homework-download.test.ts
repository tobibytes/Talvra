import { describe, expect, it, vi } from "vitest";
import { downloadHomeworkFile } from "../src/homework/download.js";

describe("homework downloads", () => {
  it("follows a relative redirect and preserves the file bytes and name", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/data.csv" } }),
      )
      .mockResolvedValueOnce(
        new Response("x,y\n1,2", {
          headers: {
            "content-type": "text/csv",
            "content-disposition": "attachment; filename*=UTF-8''course%20data.csv",
          },
        }),
      );
    const file = await downloadHomeworkFile("https://example.org/download", fetch);
    expect(file.name).toBe("course data.csv");
    expect(file.contentType).toBe("text/csv");
    expect(new TextDecoder().decode(file.data)).toBe("x,y\n1,2");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://example.org/data.csv");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fetch.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });

  it("validates redirect targets before requesting them", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }),
      );
    await expect(downloadHomeworkFile("https://example.org/data", fetch)).rejects.toThrow(
      "public HTTPS",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports failed downloads and enforces streamed size limits", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(downloadHomeworkFile("https://example.org/data", fetch)).rejects.toThrow("404");
    fetch.mockResolvedValueOnce(new Response(new Uint8Array(20 * 1024 * 1024 + 1)));
    await expect(downloadHomeworkFile("https://example.org/data", fetch)).rejects.toThrow(/large/i);
  });
});
