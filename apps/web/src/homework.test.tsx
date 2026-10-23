import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_ID, fakeApi, makeHomework, makeMe, renderApp } from "./test-utils";

describe("homework", () => {
  it("groups work by urgency and links to each workspace", async () => {
    fakeApi({
      me: makeMe(),
      homework: [
        makeHomework({
          id: crypto.randomUUID(),
          name: "Quiz 1",
          status: "overdue",
          dueAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
        makeHomework(),
        makeHomework({ id: crypto.randomUUID(), name: "Reading log", dueAt: null }),
      ],
    });
    await renderApp("/homework");
    const overdue = await screen.findByRole("region", { name: /Overdue/ });
    expect(within(overdue).getByText("Quiz 1")).toBeInTheDocument();
    const week = screen.getByRole("region", { name: /next 7 days/ });
    expect(within(week).getByRole("link", { name: /Lab 2: reverse an array/ })).toHaveAttribute(
      "href",
      `/homework/${ASSIGNMENT_ID}`,
    );
    expect(screen.getByRole("region", { name: /No due date/ })).toBeInTheDocument();
  });

  it("breaks an assignment down, and builds a plan from suggestions", async () => {
    fakeApi({ me: makeMe(), homework: [makeHomework()] });
    await renderApp(`/homework/${ASSIGNMENT_ID}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Lab 2: reverse an array" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Your work, your words")).toBeInTheDocument();
    expect(screen.getByText("in place").tagName).toBe("STRONG");

    fireEvent.click(await screen.findByRole("button", { name: /Break it down/ }));
    expect(
      await screen.findByText("Write a function that reverses an array without a built-in."),
    ).toBeInTheDocument();
    expect(screen.getByText("Is Python 3.12 OK?")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Suggest steps/ }));
    const dialog = await screen.findByRole("dialog", { name: "Suggested steps" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Outline your approach/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 step" }));
    const steps = await screen.findByRole("list", { name: "Plan steps" });
    expect(within(steps).getByText("Re-read the arrays lecture")).toBeInTheDocument();
    expect(within(steps).queryByText("Outline your approach")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New step"), { target: { value: "Test edge cases" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(await within(steps).findByText("Test edge cases")).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole("checkbox", { name: /Mark “Test edge cases” done/ }));
    await waitFor(() => expect(screen.getByText(/1 of 2 done/)).toBeInTheDocument());
  });
});

describe("today", () => {
  it("shows today's plan, overdue work, and what's coming up by day", async () => {
    fakeApi({
      me: makeMe(),
      homework: [
        makeHomework(),
        makeHomework({
          id: crypto.randomUUID(),
          name: "Quiz 1",
          status: "overdue",
          dueAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      ],
      plan: [
        {
          id: crypto.randomUUID(),
          title: "Outline the lab",
          detail: null,
          estimateMinutes: 30,
          plannedFor: "2026-10-23",
          done: false,
        },
      ],
    });
    await renderApp("/");
    expect(await screen.findByRole("region", { name: "Your plan for today" })).toHaveTextContent(
      "Outline the lab",
    );
    expect(screen.getByRole("region", { name: "Overdue" })).toHaveTextContent("Quiz 1");
    const upcoming = screen.getByRole("region", { name: "Coming up" });
    expect(within(upcoming).getByRole("link", { name: /Lab 2/ })).toBeInTheDocument();
  });

  it("celebrates an empty two weeks", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/");
    expect(await screen.findByText("Nothing due in the next two weeks")).toBeInTheDocument();
  });
});
