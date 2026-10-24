import { describe, expect, it } from "vitest";
import { courseLabel } from "./course-label";

describe("courseLabel", () => {
  it("shortens Canvas section names to the course code", () => {
    expect(courseLabel("COSC332.001_Fall 2026")).toBe("COSC 332");
    expect(courseLabel("PSYC101.W02_Fall 2026")).toBe("PSYC 101");
    expect(courseLabel("cosc 220")).toBe("COSC 220");
    expect(courseLabel(null, "MATH-241L Calculus")).toBe("MATH 241L");
  });

  it("keeps names that aren't course codes", () => {
    expect(courseLabel("Honors Seminar")).toBe("Honors Seminar");
    expect(courseLabel(undefined, "")).toBe("");
    expect(courseLabel("COSC 12345")).toBe("COSC 12345");
  });
});
