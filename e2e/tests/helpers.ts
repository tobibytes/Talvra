import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://talvra:talvra@localhost:5432/talvra",
);

/** Without RESEND_API_KEY, wrangler dev prints emails; E2E_API_LOG is that output. */
export async function verificationLink(email: string) {
  const log = process.env.E2E_API_LOG;
  if (!log) throw new Error("Set E2E_API_LOG to the wrangler dev log file");
  for (let i = 0; i < 30; i++) {
    const text = readFileSync(log, "utf8");
    const at = text.lastIndexOf(`to=${email}`);
    const link = at >= 0 ? text.slice(at).match(/https?:\/\/\S+verify-email\S+/)?.[0] : undefined;
    if (link) return new URL(link);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("verification email not found");
}

/** WCAG 2.2 AA in a real browser (unlike jsdom, this checks color contrast). */
export async function expectAccessible(page: Page) {
  // Let CSS transitions settle; otherwise axe can sample a half-faded color.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  // Nothing sticks out past the screen edge (clipped or scrolling), except inside areas
  // meant to scroll sideways (tab strips, tables). Phones showed this with long titles.
  const offscreen = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsX = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    return [...document.querySelectorAll("main *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && !scrollsX(el.parentElement);
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent ?? "").trim().slice(0, 40)}`);
  });
  expect(offscreen, "content sticks out past the screen edge").toEqual([]);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary ?? ""})`).join(", ")}`,
    ),
  ).toEqual([]);
}

export function collectCspViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}
