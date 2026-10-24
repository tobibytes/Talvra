import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, makeMe, renderApp } from "./test-utils";

describe("AI model settings", () => {
  it("checks a key, picks a model, saves it, and can go back to Talvra's AI", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/settings");
    const card = (await screen.findByRole("heading", { name: "AI model" })).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(
      await within(card).findByText(/Talvra's AI, free with daily limits/),
    ).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: /Use my own API key/ }));
    const dialog = await screen.findByRole("dialog", { name: "Use your own API key" });
    const key = within(dialog).getByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");

    fireEvent.change(key, { target: { value: "sk-ant-wrong-key-0123456789" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Check key" }));
    expect(await within(dialog).findByText("Anthropic rejected your API key.")).toBeInTheDocument();

    fireEvent.change(key, { target: { value: "sk-ant-good-key-0123456789-WXYZ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Check key" }));
    const model = await within(dialog).findByLabelText("Model");
    expect(model).toHaveValue("claude-opus-5-5");
    fireEvent.change(model, { target: { value: "claude-haiku-4-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(card).findByText("Using your key")).toBeInTheDocument();
    expect(within(card).getByText("••••WXYZ")).toBeInTheDocument();
    expect(within(card).getByText("claude-haiku-4-5")).toBeInTheDocument();
    expect(screen.queryByText("sk-ant-good-key-0123456789-WXYZ")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Stop using my key" }));
    const confirm = await screen.findByRole("dialog", { name: "Stop using your key?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove my key" }));
    await waitFor(() =>
      expect(within(card).getByText(/Talvra's AI, free with daily limits/)).toBeInTheDocument(),
    );
  });
});
