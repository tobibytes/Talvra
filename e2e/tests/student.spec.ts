import { expect, test } from "@playwright/test";
import { collectCspViolations, expectAccessible, sql, verificationLink } from "./helpers.js";

test("a student signs up, studies an upload, searches it, and deletes their account", async ({
  page,
}, info) => {
  const csp = collectCspViolations(page);
  const email = `e2e${Date.now()}${info.project.name}@morgan.edu`;

  // Sign up and verify.
  await page.goto("/sign-up");
  await expectAccessible(page);
  await page.getByLabel("Your name").fill("E2E Student");
  await page.getByLabel("Morgan email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.getByRole("heading", { name: /Check your email/ })).toBeVisible();
  const link = await verificationLink(email);
  await page.goto(link.pathname + link.search);

  // Onboarding needs a real Canvas token; the test marks the account set up instead.
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expectAccessible(page);
  await sql`update users set onboarded_at = now() where email = ${email}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /E2E/ })).toBeVisible();
  await expectAccessible(page);

  // Upload a document and read it once extracted (queue + extract container).
  await page.goto("/courses");
  await page.getByRole("button", { name: "Upload" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "Recursion notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Recursion\n\nA function that calls itself until it reaches a base case.\n\n## Base case\n\nThe stopping condition.",
    ),
  });
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 90_000 });
  const reader = page.getByRole("article", { name: "Document text" });
  await expect(reader.getByText("A function that calls itself")).toBeVisible();
  await expectAccessible(page);

  // Search finds it and links back to the right place.
  await page.goto("/search");
  // Prefix match on body text, so the snippet has a highlight.
  await page.getByLabel("Search your course material").fill("stopping cond");
  const hits = page.getByRole("region", { name: "In your material" });
  await expect(hits.getByRole("link", { name: /Recursion notes\.md/ })).toBeVisible();
  await expect(hits.locator("mark").first()).toBeVisible();
  await expectAccessible(page);

  // Reminders settings save.
  await page.goto("/reminders");
  const week = page.getByRole("button", { name: "1 week before" });
  await week.click();
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page);

  // Delete the account.
  await page.goto("/settings");
  await page.getByRole("button", { name: /Delete account/ }).click();
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await page.getByRole("button", { name: "Delete forever" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  const [row] = await sql`select count(*)::int as n from users where email = ${email}`;
  expect(row?.n).toBe(0);

  expect(csp).toEqual([]);
});
