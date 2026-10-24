import { describe, expect, it } from "vitest";
import { linkedFiles } from "../src/lib/canvas-links.js";

describe("linkedFiles", () => {
  it("finds Canvas file links in an assignment description, in order, once each", () => {
    const html = `<p>Do the tasks in
      <a class="instructure_file_link" title="HW3.pdf"
         href="https://morganstate.instructure.com/courses/77/files/9001?verifier=x&amp;wrap=1"
         data-api-endpoint="https://morganstate.instructure.com/api/v1/courses/77/files/9001">HW3_COSC251.pdf</a>
      using <a href="/courses/77/files/9002/download?download_frd=1">house_price.csv</a> and
      <a href="/files/9003">AB_NYC_2019.csv</a>.
      Again: <a href="/courses/77/files/9001">the PDF</a></p>`;
    expect(linkedFiles(html)).toEqual([
      { canvasId: "9001", label: "HW3_COSC251.pdf" },
      { canvasId: "9002", label: "house_price.csv" },
      { canvasId: "9003", label: "AB_NYC_2019.csv" },
    ]);
  });

  it("ignores links that aren't Canvas files", () => {
    const html = `<a href="https://evil.example/courses/1/files/5">x</a>
      <a href="https://morganstate.instructure.com/courses/77/pages/intro">page</a>
      <a href="https://youtube.com/watch?v=1">video</a>
      <a href="https://morganstate.instructure.com/courses/77/files">all files</a>`;
    expect(linkedFiles(html)).toEqual([]);
    expect(linkedFiles(null)).toEqual([]);
  });
});
