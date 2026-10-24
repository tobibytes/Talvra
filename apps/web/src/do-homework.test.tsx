import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_ID, fakeApi, makeHomework, makeMe, renderApp } from "./test-utils";

describe("do my homework", () => {
  it("verifies, follows up, renames, then submits the current files", async () => {
    fakeApi({ me: makeMe(), homework: [makeHomework()] });
    await renderApp(`/homework/${ASSIGNMENT_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Do my homework" }));
    await screen.findByRole("list", { name: "Files to hand in" });
    fireEvent.click(screen.getByRole("button", { name: "Verify work" }));
    const report = await screen.findByRole("region", { name: "Verification report" });
    expect(within(report).getByText("Issue found")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message the homework agent"), {
      target: { value: "Add the explanation." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send follow-up" }));
    const log = await screen.findByRole("log", { name: "Homework conversation" });
    expect(within(log).getByText("Add the explanation.")).toBeInTheDocument();
    // Replies are Markdown, rendered (not shown as raw ** and -).
    expect(within(log).getByText("explanation").tagName).toBe("STRONG");
    expect(within(log).getByRole("listitem")).toHaveTextContent("lab2.py explains the result");
    expect(within(log).getByText("lab2.py").tagName).toBe("CODE");
    expect(log).not.toHaveTextContent("**");
    expect(screen.queryByRole("region", { name: "Verification report" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename lab2.py" }));
    const rename = await screen.findByRole("dialog", { name: "Rename file" });
    fireEvent.change(within(rename).getByLabelText("File name"), {
      target: { value: "Final lab.py" },
    });
    fireEvent.click(within(rename).getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("link", { name: "Download Final lab.py" })).toHaveAttribute(
      "download",
      "Final lab.py",
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit to Canvas" }));
    const submit = await screen.findByRole("dialog", { name: "Submit to Canvas?" });
    expect(within(submit).getByText("Final lab.py")).toBeInTheDocument();
    fireEvent.click(within(submit).getByRole("button", { name: "Submit 1 file" }));
    expect(await screen.findByRole("button", { name: "Submitted to Canvas" })).toBeDisabled();
  });
  it("is available to every signed-in account", async () => {
    fakeApi({ me: makeMe(), homework: [makeHomework()] });
    await renderApp(`/homework/${ASSIGNMENT_ID}`);
    expect(await screen.findByRole("heading", { name: "Do my homework" })).toBeInTheDocument();
    expect(screen.queryByText("Your work, your words")).not.toBeInTheDocument();
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
    fireEvent.click(within(card).getByRole("button", { name: /Do my homework/ }));
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
