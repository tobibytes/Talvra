import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOC_ID, fakeApi, makeAid, makeCard, makeDocument, makeMe, renderApp } from "./test-utils";

describe("study aids on the document page", () => {
  it("makes notes on request, then shows them with citations back to the page", async () => {
    const api = fakeApi({ me: makeMe(), documents: [makeDocument()] });
    await renderApp(`/documents/${DOC_ID}?tab=notes`);
    fireEvent.click(await screen.findByRole("button", { name: "Make study notes" }));
    const notes = await screen.findByRole("article", { name: "Study notes" }, { timeout: 8000 });
    expect(within(notes).getByText("Arrays store elements contiguously.")).toBeInTheDocument();
    expect(within(notes).getByRole("link", { name: "Source: p. 1" })).toHaveAttribute(
      "href",
      `/documents/${DOC_ID}?tab=read#page-1`,
    );
    expect(screen.getByText(/version 1/)).toBeInTheDocument();
    expect(
      api.mock.calls.some(
        ([u, init]) => String(u).endsWith(`/documents/${DOC_ID}/aids`) && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("keeps the last good version visible when a new one failed", async () => {
    fakeApi({
      me: makeMe(),
      documents: [makeDocument()],
      aids: [
        makeAid("notes"),
        makeAid("notes", { version: 2, status: "failed", content: null, error: "Claude is busy." }),
      ],
    });
    await renderApp(`/documents/${DOC_ID}?tab=notes`);
    expect(await screen.findByText("The new version didn't work")).toBeInTheDocument();
    expect(screen.getByText("Arrays store elements contiguously.")).toBeInTheDocument();
  });

  it("runs a practice quiz with feedback and a score", async () => {
    fakeApi({ me: makeMe(), documents: [makeDocument()], aids: [makeAid("quiz")] });
    await renderApp(`/documents/${DOC_ID}?tab=quiz`);
    expect(await screen.findByText("Practice only, not graded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "As linked nodes" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText(/Not quite\. The answer is: Contiguously/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "address math" } });
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText(/base \+ index/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I got it" }));
    expect(screen.getByRole("heading", { name: "1 of 2 right" })).toBeInTheDocument();
  });

  it("links a deck to a focused review session", async () => {
    fakeApi({ me: makeMe(), documents: [makeDocument()], aids: [makeAid("flashcards")] });
    await renderApp(`/documents/${DOC_ID}?tab=flashcards`);
    expect(await screen.findByRole("link", { name: /Study these/ })).toHaveAttribute(
      "href",
      `/review?documentId=${DOC_ID}`,
    );
  });
});

describe("review", () => {
  it("flips with Space and grades with number keys, then finishes", async () => {
    fakeApi({
      me: makeMe(),
      cards: [makeCard(), makeCard({ front: "What links list nodes?", back: "Pointers." })],
    });
    await renderApp("/review");
    expect(
      await screen.findByRole("heading", { name: "How are arrays stored?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Contiguously, in one block.")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("Contiguously, in one block.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "3" });
    expect(
      await screen.findByRole("heading", { name: "What links list nodes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show answer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Again/ }));
    expect(await screen.findByText("Session done")).toBeInTheDocument();
    expect(screen.getByText(/1 will come back soon/)).toBeInTheDocument();
  });

  it("says when nothing is due", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/review");
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("shows due cards on Today", async () => {
    fakeApi({ me: makeMe(), cards: [makeCard(), makeCard()] });
    await renderApp("/");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Review 2 cards/ })).toHaveAttribute(
        "href",
        "/review",
      ),
    );
  });
});
