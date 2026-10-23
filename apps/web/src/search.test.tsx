import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOC_ID, fakeApi, makeMe, renderApp } from "./test-utils";

describe("search", () => {
  it("searches as you type, highlights matches and links to the exact page", async () => {
    fakeApi({ me: makeMe() });
    const { router } = await renderApp("/search");
    fireEvent.change(await screen.findByLabelText("Search your course material"), {
      target: { value: "contig" },
    });
    const hits = await screen.findByRole("region", { name: "In your material" });
    expect(within(hits).getByText("contiguously").tagName).toBe("MARK");
    expect(within(hits).getByRole("link", { name: /Lecture 1\.pdf/ })).toHaveAttribute(
      "href",
      `/documents/${DOC_ID}?tab=read#page-3`,
    );
    expect(screen.getByRole("region", { name: "Jump to" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: "contig" }));
  });

  it("offers to ask when nothing matches", async () => {
    fakeApi({ me: makeMe() });
    const { router } = await renderApp("/search?q=zebra");
    fireEvent.click(await screen.findByRole("button", { name: /Ask instead/ }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ mode: "ask", q: "zebra" }),
    );
    expect(await screen.findByLabelText("Your question")).toHaveValue("zebra");
  });
});

describe("ask", () => {
  it("streams an answer with numbered sources that open the cited page", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/search?mode=ask");
    fireEvent.change(await screen.findByLabelText("Your question"), {
      target: { value: "How are arrays stored?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const convo = await screen.findByRole("list", { name: "Conversation" });
    expect(await within(convo).findByText("contiguously")).toBeInTheDocument();
    expect(within(convo).getByText("How are arrays stored?")).toBeInTheDocument();
    expect(
      within(convo).getByRole("link", { name: "Source 1: Lecture 1.pdf, p. 3" }),
    ).toHaveAttribute("href", `/documents/${DOC_ID}?tab=read#page-3`);
    expect(screen.getByLabelText("Your question")).toHaveValue("");
  });
});

describe("command palette", () => {
  it("finds course material and offers to ask", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByPlaceholderText("Search pages and actions…"), {
      target: { value: "arrays" },
    });
    expect(await screen.findByRole("option", { name: /Lecture 1\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ask “arrays”/ })).toBeInTheDocument();
  });
});
