import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NBBUILD_PY } from "../src/ai/nbbuild-source.js";

describe("nbbuild helper", () => {
  it("the bundled copy matches nbbuild.py (run: node scripts/gen-nbbuild.mjs)", () => {
    const src = readFileSync(new URL("../src/ai/nbbuild.py", import.meta.url), "utf8");
    expect(NBBUILD_PY).toBe(src);
  });
});
