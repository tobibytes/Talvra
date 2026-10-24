import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

describe("OAuth consent (MCP connectors)", () => {
  it("names the app, lists what it can do, and sends the student back after Allow", async () => {
    fakeApi({ me: makeMe() });
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    } as Location);
    await renderApp("/oauth/consent?client_id=chatgpt-1&scope=openid");
    const card = await screen.findByRole("region", { name: "ChatGPT wants to use your Talvra" });
    expect(within(card).getByRole("list", { name: "It will be able to" })).toHaveTextContent(
      "Read your courses",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Allow ChatGPT" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://chatgpt.com/cb?code=abc&state=s"),
    );
    vi.restoreAllMocks();
  });

  it("sends a signed-out student to sign in first", async () => {
    fakeApi({ me: null });
    const { router } = await renderApp("/oauth/consent?client_id=chatgpt-1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });
});

describe("connected apps in Settings", () => {
  it("lists connected apps and disconnects after confirming", async () => {
    fakeApi({
      me: makeMe(),
      connectedApps: [
        { clientId: "c1", name: "ChatGPT", uri: null, connectedAt: new Date().toISOString() },
      ],
    });
    await renderApp("/settings");
    const list = await screen.findByRole("list", { name: "Connected apps" });
    fireEvent.click(within(list).getByRole("button", { name: "Disconnect ChatGPT" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect ChatGPT?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Connected apps" })).not.toBeInTheDocument(),
    );
  });
});
