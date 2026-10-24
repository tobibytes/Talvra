import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COURSE_ID, fakeApi, makeCourse, makeMe, makeRun, renderApp } from "./test-utils";

describe("courses", () => {
  it("lists the selected courses with their last sync", async () => {
    fakeApi({
      me: makeMe(),
      courses: [
        makeCourse(),
        makeCourse({ id: crypto.randomUUID(), name: "Not picked", selected: false }),
      ],
    });
    await renderApp("/courses");
    const link = await screen.findByRole("link", { name: /COSC 220 Data Structures/ });
    expect(link).toHaveAttribute("href", `/courses/${COURSE_ID}`);
    expect(screen.queryByText("Not picked")).not.toBeInTheDocument();
  });

  it("shows modules, files and assignments in tabs", async () => {
    fakeApi({ me: makeMe(), courses: [makeCourse()] });
    const { router } = await renderApp(`/courses/${COURSE_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "COSC 220" })).toBeInTheDocument();
    // The full Canvas name is still shown under the short label.
    expect(screen.getByText("COSC 220 Data Structures")).toBeInTheDocument();

    // Modules (default tab): items link to Canvas; sub-headers are labels.
    const week = await screen.findByRole("region", { name: "Week 1: Arrays" });
    expect(within(week).getByRole("link", { name: /Lecture 1 slides/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(within(week).getByText("Readings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Files/ }));
    expect(await screen.findByText("Lecture 1.pdf")).toBeInTheDocument();
    expect(screen.getByText("Welcome to COSC 220")).toBeInTheDocument();
    expect(screen.getAllByText("PDF").length).toBeGreaterThan(0);
    expect(screen.getByText("2.3 MB")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "files" }));

    fireEvent.click(screen.getByRole("tab", { name: /Assignments/ }));
    expect(await screen.findByText("Lab 1")).toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();
    // Soonest due first; no-due-date last.
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(rows.findIndex((t) => t.includes("Lab 1"))).toBeLessThan(
      rows.findIndex((t) => t.includes("Homework 1")),
    );
  });

  it("filters files by module from the URL", async () => {
    fakeApi({ me: makeMe(), courses: [makeCourse()] });
    await renderApp(`/courses/${COURSE_ID}?tab=files&module=22222222-2222-4222-8222-222222222222`);
    expect(await screen.findByText("Lecture 1.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to COSC 220")).not.toBeInTheDocument();
  });

  it("shows a designed not-found state for someone else's course", async () => {
    fakeApi({ me: makeMe() });
    await renderApp(`/courses/${crypto.randomUUID()}`);
    expect(await screen.findByText("Course not found")).toBeInTheDocument();
  });
});

describe("sync status", () => {
  it("says when it's never synced, and starts a sync", async () => {
    const api = fakeApi({ me: makeMe() });
    await renderApp("/");
    expect(await screen.findByText("Not synced yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("button", { name: "Syncing…" })).toBeDisabled();
    expect(
      api.mock.calls.some(
        ([u, init]) => String(u).endsWith("/api/v1/sync") && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("shows the last successful sync", async () => {
    fakeApi({ me: makeMe(), runs: [makeRun({ finishedAt: new Date().toISOString() })] });
    await renderApp("/");
    expect(await screen.findByText(/Last synced just now/)).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("shows live progress while running", async () => {
    fakeApi({
      me: makeMe(),
      runs: [makeRun({ status: "running", finishedAt: null })],
    });
    await renderApp("/");
    expect(await screen.findByText("Syncing your courses now.")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 courses")).toBeInTheDocument();
  });

  it("offers to replace the token when Canvas rejected it", async () => {
    fakeApi({
      me: makeMe(),
      runs: [
        makeRun({
          status: "failed",
          errorCode: "canvas_token_invalid",
          error: "Canvas stopped accepting your token. Replace it in Settings.",
        }),
      ],
    });
    await renderApp("/");
    expect(await screen.findByText(/Canvas stopped accepting your token/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Replace token" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
