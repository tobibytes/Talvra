import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { allNav } from "@/lib/nav";
import { COURSE_ID, fakeApi, makeCourse, makeMe, makeRun, renderApp } from "./test-utils";

const signedIn = () => fakeApi({ me: makeMe() });
const withData = () => fakeApi({ me: makeMe(), courses: [makeCourse()], runs: [makeRun()] });

describe("app shell", () => {
  it("links every page from the sidebar and marks the current one", async () => {
    signedIn();
    await renderApp("/courses");
    await screen.findByRole("heading", { level: 1, name: "Courses" });
    for (const item of allNav) {
      expect(screen.getAllByRole("link", { name: item.label }).length).toBeGreaterThan(0);
    }
    const current = screen
      .getAllByRole("link", { name: "Courses" })
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
  });

  it("has a 5-tab mobile bar", async () => {
    signedIn();
    await renderApp("/");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(bar).getAllByRole("link")).toHaveLength(5);
  });

  it("greets the user and shows API health from /api/health", async () => {
    const api = signedIn();
    await renderApp("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: /, Oluwatobi$/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText("All systems normal")).toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => String(url).endsWith("/api/health"))).toBe(true);
  });

  it("opens the command palette with Ctrl+K and navigates", async () => {
    signedIn();
    const { router } = await renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText("Search pages and actions…");
    fireEvent.change(input, { target: { value: "remind" } });
    fireEvent.click(await screen.findByRole("option", { name: /Reminders/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/reminders"));
    expect(await screen.findByRole("heading", { level: 1, name: "Reminders" })).toBeInTheDocument();
  });

  it("renders a designed not-found page", async () => {
    signedIn();
    await renderApp("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});

describe("accessibility (axe, WCAG 2.2 AA rules)", () => {
  const pages: [string, () => void][] = [
    ["/", signedIn],
    ["/courses", signedIn],
    ["/courses (with data)", withData],
    [`/courses/${COURSE_ID}`, withData],
    [`/courses/${COURSE_ID}?tab=files`, withData],
    [`/courses/${COURSE_ID}?tab=assignments`, withData],
    ["/homework", signedIn],
    ["/search", signedIn],
    ["/reminders", signedIn],
    ["/settings", signedIn],
    ["/gallery", signedIn],
    ["/sign-in", () => fakeApi({ me: null })],
    ["/sign-up", () => fakeApi({ me: null })],
    ["/forgot-password", () => fakeApi({ me: null })],
    ["/check-email?email=a@morgan.edu", () => fakeApi({ me: null })],
    ["/onboarding", () => fakeApi({ me: makeMe({ onboarded: false, canvas: null }) })],
  ];
  for (const [path, setup] of pages) {
    it(`has no violations on ${path}`, async () => {
      setup();
      const { container } = await renderApp(path.replace(" (with data)", ""));
      await screen.findByRole("heading", { level: 1 });
      // Let queries settle so we scan the loaded state, not just skeletons.
      await new Promise((r) => setTimeout(r, 50));
      const result = await axe.run(container, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
        // jsdom can't compute layout colors; contrast is checked in the browser pass.
        rules: { "color-contrast": { enabled: false } },
      });
      const summary = result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
      );
      expect(summary).toEqual([]);
    });
  }
});
