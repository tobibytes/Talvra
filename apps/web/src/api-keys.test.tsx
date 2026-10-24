import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

describe("API keys (MCP)", () => {
  it("makes a key, shows it once with setup, lists it, and revokes it after confirming", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/settings");
    const card = (await screen.findByRole("heading", { name: "AI assistants (MCP)" })).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(within(card).getByLabelText("Server URL")).toHaveValue(
      `${window.location.origin}/api/mcp`,
    );
    expect(await within(card).findByText(/No keys yet/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "New key" }));
    const make = await screen.findByRole("dialog", { name: "New API key" });
    const submit = within(make).getByRole("button", { name: "Make key" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(make).getByLabelText("Name"), { target: { value: "Claude Desktop" } });
    fireEvent.click(submit);

    const shown = await screen.findByRole("dialog", { name: "Copy your key now" });
    const secret = within(shown).getByLabelText("API key") as HTMLInputElement;
    expect(secret.value).toMatch(/^tlv_/);
    const setup = within(shown).getByLabelText("Claude Code") as HTMLInputElement;
    expect(setup.value).toContain(`--header "Authorization: Bearer ${secret.value}"`);
    fireEvent.click(within(shown).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const list = await within(card).findByRole("list", { name: "API keys" });
    expect(within(list).getByText("Claude Desktop")).toBeInTheDocument();
    expect(within(list).getByText("never used", { exact: false })).toBeInTheDocument();
    // The full key is never shown again.
    expect(card).not.toHaveTextContent(/tlv_x/);

    fireEvent.click(within(list).getByRole("button", { name: "Revoke Claude Desktop" }));
    const confirm = await screen.findByRole("dialog", { name: "Revoke Claude Desktop?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke key" }));
    expect(await within(card).findByText(/No keys yet/)).toBeInTheDocument();
  });
});
