import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allNav } from "@/lib/nav";
import { renderApp } from "./test-utils";

beforeEach(() => {
  // The shell polls /health; keep it offline and deterministic.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status: "ok", version: "test", checks: { database: "ok" } }), {
      status: 200,
    }),
  );
});

describe("app shell", () => {
  it("links every page from the sidebar and marks the current one", async () => {
    await renderApp("/courses");
    const nav = screen.getAllByRole("list")[0];
    expect(nav).toBeDefined();
    for (const item of allNav) {
      expect(screen.getAllByRole("link", { name: item.label }).length).toBeGreaterThan(0);
    }
    const current = screen
      .getAllByRole("link", { name: "Courses" })
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
  });

  it("has a 5-tab mobile bar", async () => {
    await renderApp("/");
    const bar = screen.getByRole("navigation", { name: "Primary" });
    expect(within(bar).getAllByRole("link")).toHaveLength(5);
  });

  it("shows API health from API_BASE in the sidebar", async () => {
    await renderApp("/");
    expect(await screen.findByText("All systems normal")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^http.*\/health$/),
      expect.anything(),
    );
  });

  it("opens the command palette with Ctrl+K and navigates", async () => {
    const { router } = await renderApp("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText("Search pages and actions…");
    fireEvent.change(input, { target: { value: "remind" } });
    fireEvent.click(await screen.findByRole("option", { name: /Reminders/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/reminders"));
    expect(await screen.findByRole("heading", { level: 1, name: "Reminders" })).toBeInTheDocument();
  });

  it("renders a designed not-found page", async () => {
    await renderApp("/does-not-exist");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});

describe("accessibility (axe, WCAG 2.2 AA rules)", () => {
  for (const path of [
    "/",
    "/courses",
    "/homework",
    "/search",
    "/reminders",
    "/settings",
    "/gallery",
  ]) {
    it(`has no violations on ${path}`, async () => {
      const { container } = await renderApp(path);
      await screen.findByRole("heading", { level: 1 });
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
