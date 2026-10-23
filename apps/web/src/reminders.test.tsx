import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

describe("reminders", () => {
  it("shows settings and what's coming, and saves a change right away", async () => {
    const state = { me: makeMe() } as Parameters<typeof fakeApi>[0];
    const api = fakeApi(state);
    await renderApp("/reminders");
    const upcoming = await screen.findByRole("region", { name: "Coming up" });
    expect(within(upcoming).getByText("Lab 2: reverse an array")).toBeInTheDocument();
    expect(within(upcoming).getByText(/1 day before/)).toBeInTheDocument();
    const week = screen.getByRole("button", { name: "1 week before" });
    expect(week).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(week);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "1 week before" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    const put = api.mock.calls.find(
      ([u, init]) => String(u).endsWith("/reminders/prefs") && init?.method === "PUT",
    );
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ offsets: [1440, 180, 10080] });
  });

  it("turns email off and says so", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/reminders");
    fireEvent.click(await screen.findByRole("switch", { name: "Email reminders" }));
    expect(await screen.findByText("Email reminders are off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 day before" })).toBeDisabled();
  });

  it("sends a test email", async () => {
    const api = fakeApi({ me: makeMe() });
    await renderApp("/reminders");
    fireEvent.click(await screen.findByRole("button", { name: /Send a test/ }));
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([u, init]) => String(u).endsWith("/reminders/test") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });
});
