import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOC_ID, fakeApi, makeDocument, makeMe, renderApp } from "./test-utils";

describe("document page", () => {
  it("renders the extracted text with an outline and links back to Canvas", async () => {
    fakeApi({ me: makeMe(), documents: [makeDocument()] });
    await renderApp(`/documents/${DOC_ID}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Lecture 1.pdf" }),
    ).toBeInTheDocument();
    const article = await screen.findByRole("article", { name: "Document text" });
    expect(within(article).getByText("contiguously").tagName).toBe("STRONG");
    expect(within(article).getByRole("table")).toBeInTheDocument();
    const outline = screen.getByRole("navigation", { name: "Outline" });
    expect(within(outline).getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "href",
      "#page-2",
    );
    expect(document.getElementById("page-2")).not.toBeNull();
    expect(screen.getByText(/2 pages · 1,234 words/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Canvas/ })[0]).toHaveAttribute(
      "href",
      "https://morganstate.instructure.com/courses/101/files/501",
    );
    expect(screen.getByRole("link", { name: /Original/ })).toHaveAttribute(
      "href",
      `/api/v1/documents/${DOC_ID}/original`,
    );
    // Breadcrumb goes back to the course's files.
    expect(screen.getByRole("link", { name: "COSC 220" })).toHaveAttribute(
      "href",
      expect.stringContaining("tab=files"),
    );
  });

  it("shows progress while processing", async () => {
    fakeApi({ me: makeMe(), documents: [makeDocument({ status: "extracting" })] });
    await renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText("Getting this ready")).toBeInTheDocument();
    expect(screen.getByText("Reading it")).toBeInTheDocument();
    expect(screen.getByText("(in progress)")).toBeInTheDocument();
  });

  it("explains a failure and retries", async () => {
    fakeApi({
      me: makeMe(),
      documents: [makeDocument({ status: "failed", error: "Couldn't open this PDF." })],
    });
    await renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText("Couldn't open this PDF.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Getting this ready")).toBeInTheDocument();
  });

  it("says plainly when a file type can't be read", async () => {
    fakeApi({
      me: makeMe(),
      documents: [
        makeDocument({
          title: "Lecture recording.mp4",
          status: "unsupported",
          error: "Talvra can't read this type of file yet.",
        }),
      ],
    });
    await renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText("Talvra can't read this file")).toBeInTheDocument();
  });

  it("warns when a PDF looks scanned", async () => {
    fakeApi({ me: makeMe(), documents: [makeDocument({ warnings: ["little_text"] })] });
    await renderApp(`/documents/${DOC_ID}`);
    expect(await screen.findByText("This looks like a scan")).toBeInTheDocument();
  });

  it("shows a designed not-found state", async () => {
    fakeApi({ me: makeMe() });
    await renderApp(`/documents/${crypto.randomUUID()}`);
    expect(await screen.findByText("Document not found")).toBeInTheDocument();
  });
});

describe("uploads", () => {
  it("lists uploads on the Courses page", async () => {
    fakeApi({
      me: makeMe(),
      documents: [makeDocument({ source: "upload", title: "My notes.md", courseId: null })],
    });
    await renderApp("/courses");
    const section = await screen.findByRole("region", { name: "Your uploads" });
    expect(within(section).getByRole("link", { name: /My notes\.md/ })).toHaveAttribute(
      "href",
      `/documents/${DOC_ID}`,
    );
  });

  it("refuses unsupported files before uploading", async () => {
    const api = fakeApi({ me: makeMe() });
    await renderApp("/courses");
    fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
    const input = await screen.findByLabelText(/Drop a file here/);
    fireEvent.change(input, {
      target: { files: [new File(["x"], "movie.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Talvra reads \.pdf/);
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([u, init]) => String(u).endsWith("/api/v1/documents") && init?.method === "POST",
        ),
      ).toBe(false),
    );
  });
});
