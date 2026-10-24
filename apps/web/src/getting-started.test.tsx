import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

const steps = (done: number) => {
  const keys = ["canvas", "studyAid", "review", "ask", "assistant"] as const;
  return Object.fromEntries(keys.map((k, i) => [k, i < done])) as Record<
    (typeof keys)[number],
    boolean
  >;
};

describe("Get started on Today", () => {
  it("shows progress, done steps and links to the rest, and hides when dismissed", async () => {
    fakeApi({ me: makeMe(), gettingStarted: { steps: steps(2), dismissed: false } });
    await renderApp("/");
    const card = await screen.findByRole("region", { name: "Get started" });
    expect(within(card).getByText("2 / 5")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    // Done steps are text; the rest link to where you do them.
    expect(within(card).getByText(/Connect Canvas/)).toHaveTextContent("(done)");
    expect(within(card).queryByRole("link", { name: /Connect Canvas/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Review your flashcards/ })).toHaveAttribute(
      "href",
      "/review",
    );
    expect(
      within(card).getByRole("link", { name: /Use Talvra from ChatGPT or Claude/ }),
    ).toHaveAttribute("href", "/settings");

    fireEvent.click(within(card).getByRole("button", { name: "Hide get started" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Get started" })).not.toBeInTheDocument(),
    );
  });

  it("says you're all set once, then stays gone", async () => {
    const state = { me: makeMe(), gettingStarted: { steps: steps(5), dismissed: false } };
    fakeApi(state);
    await renderApp("/");
    expect(await screen.findByText("You're all set.")).toBeInTheDocument();
    // It recorded the dismissal so the next visit doesn't show it.
    await waitFor(() => expect(state.gettingStarted.dismissed).toBe(true));
  });

  it("stays hidden once dismissed", async () => {
    fakeApi({ me: makeMe(), gettingStarted: { steps: steps(1), dismissed: true } });
    await renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Get started" })).not.toBeInTheDocument();
  });
});
