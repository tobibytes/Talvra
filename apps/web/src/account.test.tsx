import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

describe("your data", () => {
  it("downloads data and deletes the account only after typing the email", async () => {
    const api = fakeApi({ me: makeMe() });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await renderApp("/settings");
    expect(await screen.findByRole("link", { name: /Download my data/ })).toHaveAttribute(
      "href",
      "/api/v1/me/export",
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete account/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    const del = within(dialog).getByRole("button", { name: "Delete forever" });
    expect(del).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type olola@morgan.edu/), {
      target: { value: "olola@morgan.edu" },
    });
    expect(del).toBeEnabled();
    fireEvent.click(del);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in?deleted=1"));
    expect(
      api.mock.calls.some(
        ([u, init]) => String(u).endsWith("/api/v1/me") && init?.method === "DELETE",
      ),
    ).toBe(true);
    vi.unstubAllGlobals();
  });
});
