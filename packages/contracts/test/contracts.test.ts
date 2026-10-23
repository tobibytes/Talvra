import { describe, expect, it } from "vitest";
import { ApiError, CourseList, errorStatus, PageQuery } from "../src/index.js";

describe("contracts", () => {
  it("defaults and bounds page size", () => {
    expect(PageQuery.parse({}).limit).toBe(25);
    expect(PageQuery.parse({ limit: "10" }).limit).toBe(10);
    expect(PageQuery.safeParse({ limit: 500 }).success).toBe(false);
  });

  it("validates the error envelope", () => {
    const ok = ApiError.safeParse({
      error: { code: "not_found", message: "Course not found", requestId: "req_1" },
    });
    expect(ok.success).toBe(true);
    expect(
      ApiError.safeParse({ error: { code: "nope", message: "", requestId: "x" } }).success,
    ).toBe(false);
  });

  it("maps every error code to an HTTP status", () => {
    for (const status of Object.values(errorStatus)) expect(status).toBeGreaterThanOrEqual(400);
  });

  it("parses a course page", () => {
    const parsed = CourseList.parse({
      items: [
        {
          id: "0b8f6c3e-6a0a-4b6a-9c43-2f1f4e1a8c11",
          canvasId: "1234",
          name: "COSC 220 Data Structures",
          courseCode: "COSC 220",
          term: "Fall 2026",
          selected: true,
          lastSyncedAt: "2026-10-23T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(parsed.items[0]?.name).toContain("Data Structures");
  });
});

import { ConnectCanvas } from "../src/index.js";

describe("ConnectCanvas", () => {
  const token = "1234~abcdefghijklmnopqrstuvwxyz";
  it("defaults to Morgan's Canvas and normalizes to the origin", () => {
    expect(ConnectCanvas.parse({ token }).baseUrl).toBe("https://morgan.instructure.com");
    expect(
      ConnectCanvas.parse({ token, baseUrl: "https://morgan.instructure.com/courses/1" }).baseUrl,
    ).toBe("https://morgan.instructure.com");
  });

  it("rejects hosts that aren't Canvas, to prevent SSRF", () => {
    for (const baseUrl of [
      "http://morgan.instructure.com",
      "https://evil.com",
      "https://instructure.com.evil.com",
      "https://169.254.169.254",
      "https://localhost",
    ]) {
      expect(ConnectCanvas.safeParse({ token, baseUrl }).success, baseUrl).toBe(false);
    }
  });
});
