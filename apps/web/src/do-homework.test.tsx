import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_ID, fakeApi, makeHomework, makeMe, renderApp } from "./test-utils";

describe("do my homework", () => {
  it("is hidden unless the account has the feature", async () => {
    fakeApi({ me: makeMe(), homework: [makeHomework()] });
    await renderApp(`/homework/${ASSIGNMENT_ID}`);
    expect(await screen.findByText("Your work, your words")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Do my homework" })).not.toBeInTheDocument();
  });

  it("writes the files, previews them, and submits only after confirming", async () => {
    fakeApi({ me: makeMe({ features: { doHomework: true } }), homework: [makeHomework()] });
    await renderApp(`/homework/${ASSIGNMENT_ID}`);
    const card = (await screen.findByRole("heading", { name: "Do my homework" })).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(screen.queryByText("Your work, your words")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Submit to Canvas/ })).toBeNull();

    fireEvent.change(await within(card).findByLabelText(/Anything to know first/), {
      target: { value: "Use numpy" },
    });
    fireEvent.click(within(card).getByRole("button", { name: /Write it/ }));
    const files = await within(card).findByRole("list", { name: "Files to hand in" });
    expect(within(files).getByText("lab2.py")).toBeInTheDocument();
    expect(within(card).getByText("Put your name at the top.")).toBeInTheDocument();
    expect(within(card).getByText(/with your note: “Use numpy”/)).toBeInTheDocument();
    expect(within(files).getByRole("link", { name: "Download lab2.py" })).toHaveAttribute(
      "href",
      expect.stringContaining("/draft/files/lab2.py"),
    );

    fireEvent.click(within(files).getByRole("button", { name: "Preview lab2.py" }));
    expect(await within(files).findByText(/print\("answer"\)/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: /Submit to Canvas/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit to Canvas?" });
    expect(within(dialog).getByText("lab2.py")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit 1 file" }));
    await waitFor(() => expect(within(card).getByText("Submitted")).toBeInTheDocument());
  });
});
