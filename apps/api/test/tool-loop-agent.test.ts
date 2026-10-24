import { describe, expect, it, vi } from "vitest";
import { GenerationError } from "../src/ai/claude.js";
import {
  clip,
  type ExecResult,
  type ModelDriver,
  type ModelTurn,
  runToolLoop,
  type Sandbox,
  type ToolResult,
} from "../src/ai/tool-loop-agent.js";

const text = (s: string) => new TextEncoder().encode(s);
const read = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

/** An in-memory sandbox. `run` decides what each command does to the files. */
function fakeSandbox(run?: (cmd: string, files: Map<string, Uint8Array>) => Partial<ExecResult>) {
  const files = new Map<string, Uint8Array>();
  const sandbox: Sandbox & { closed: boolean; commands: string[] } = {
    closed: false,
    commands: [],
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    readFile: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error(`no ${path}`);
      return f;
    },
    exec: async (cmd) => {
      sandbox.commands.push(cmd);
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...run?.(cmd, files) };
    },
    listOutputs: async () =>
      [...files.keys()].filter((p) => p.startsWith("output/")).map((p) => p.slice(7)),
    close: async () => {
      sandbox.closed = true;
    },
  };
  return { sandbox, files };
}

const turn = (calls: ModelTurn["calls"], stop: ModelTurn["stop"] = "tool_calls"): ModelTurn => ({
  text: "",
  calls,
  stop,
  model: "fake-model",
  usage: { inputTokens: 10, outputTokens: 5 },
});

/** A scripted model. Records what it was sent each turn. */
function fakeDriver(script: ModelTurn[]) {
  const sent: { text?: string; results?: ToolResult[] }[] = [];
  const started: Parameters<ModelDriver["start"]>[0][] = [];
  const driver: ModelDriver = {
    start: (opts) => {
      started.push(opts);
      return {
        send: async (m) => {
          sent.push(structuredClone(m));
          const next = script.shift();
          if (!next) throw new Error("script ran out");
          return next;
        },
      };
    },
  };
  return { driver, sent, started };
}

const base = { system: "sys", prompt: "Do question 1.", inputs: [] };

describe("tool-loop homework agent", () => {
  it("uploads inputs, runs commands and hands in files from $OUTPUT_DIR", async () => {
    const { sandbox, files } = fakeSandbox((cmd, f) => {
      if (cmd.includes("solve")) f.set("output/answer.md", text("# Answer\n42"));
      return { stdout: "done" };
    });
    const { driver, sent, started } = fakeDriver([
      turn([{ id: "c1", name: "bash", input: { command: "python solve.py" } }]),
      turn([{ id: "c2", name: "hand_in", input: { files: ["answer.md"], notes: "Check q1." } }]),
    ]);
    const progress = vi.fn();
    const out = await runToolLoop(driver, async () => sandbox, {
      ...base,
      inputs: [{ name: "hw.pdf", data: text("%PDF"), contentType: "application/pdf" }],
      onProgress: progress,
    });

    expect(out.files.map((f) => [f.name, read(f.data)])).toEqual([["answer.md", "# Answer\n42"]]);
    expect(out.notes).toBe("Check q1.");
    expect(out.model).toBe("fake-model");
    expect(out.usage).toEqual({ inputTokens: 20, outputTokens: 10, webSearches: 0, turns: 2 });
    expect(read(files.get("input/hw.pdf"))).toBe("%PDF");
    expect(files.has("input/nbbuild.py")).toBe(true);
    expect(started[0]?.tools.map((t) => t.name)).toEqual(["bash", "download_file", "hand_in"]);
    expect(sent[0]?.text).toContain("Files in $INPUT_DIR: hw.pdf, nbbuild.py.");
    expect(sent[1]?.results).toEqual([
      { callId: "c1", content: "Exit code 0.\n<stdout>\ndone\n</stdout>", isError: false },
    ]);
    expect(progress).toHaveBeenCalledWith("Running Python");
    expect(sandbox.closed).toBe(true);
  });

  it("tells the model which files are missing, then accepts a corrected hand_in", async () => {
    const { sandbox, files } = fakeSandbox();
    files.set("output/report.md", text("ok"));
    const { driver, sent } = fakeDriver([
      turn([{ id: "h1", name: "hand_in", input: { files: ["report.pdf"], notes: "n" } }]),
      turn([
        { id: "h2", name: "hand_in", input: { files: ["/work/output/report.md"], notes: "n" } },
      ]),
    ]);
    const out = await runToolLoop(driver, async () => sandbox, base);
    expect(sent[1]?.results?.[0]?.isError).toBe(true);
    expect(sent[1]?.results?.[0]?.content).toContain("Not found in $OUTPUT_DIR: report.pdf");
    expect(sent[1]?.results?.[0]?.content).toContain("Files there: report.md");
    expect(out.files.map((f) => f.name)).toEqual(["report.md"]);
  });

  it("verify mode offers verification_result instead of hand_in and returns the report", async () => {
    const { sandbox } = fakeSandbox();
    const report = {
      summary: "Runs fine",
      checks: [{ name: "Executes", status: "passed", detail: "printed 15" }],
    };
    const { driver, started, sent } = fakeDriver([
      turn([{ id: "h", name: "hand_in", input: { files: [], notes: "" } }]),
      turn([{ id: "v", name: "verification_result", input: report }]),
    ]);
    const out = await runToolLoop(driver, async () => sandbox, { ...base, mode: "verify" });
    expect(started[0]?.tools.map((t) => t.name)).toContain("verification_result");
    expect(started[0]?.tools.map((t) => t.name)).not.toContain("hand_in");
    expect(started[0]?.system).toContain("verification only");
    expect(sent[1]?.results?.[0]).toMatchObject({ content: "Unknown tool.", isError: true });
    expect(out.verification).toEqual(report);
    expect(out.files).toEqual([]);
  });

  it("downloads through our server into $INPUT_DIR, within the limits", async () => {
    const { sandbox, files } = fakeSandbox();
    files.set("output/a.txt", text("a"));
    const fetchUrl = vi.fn(async () => ({
      name: "data.csv",
      data: text("x,y\n1,2"),
      contentType: "text/csv",
    }));
    const { driver, sent } = fakeDriver([
      turn([
        { id: "d1", name: "download_file", input: { url: "https://example.com/data.csv" } },
        { id: "d2", name: "download_file", input: { url: "not a url" } },
      ]),
      turn([{ id: "h", name: "hand_in", input: { files: ["a.txt"], notes: "" } }]),
    ]);
    await runToolLoop(driver, async () => sandbox, { ...base, fetchUrl });
    expect(read(files.get("input/data.csv"))).toBe("x,y\n1,2");
    expect(sent[1]?.results).toEqual([
      { callId: "d1", content: "Saved data.csv (7 bytes) to $INPUT_DIR." },
      { callId: "d2", content: "download_file needs a valid URL.", isError: true },
    ]);
  });

  it("marks failed and timed-out commands as errors and clips long output", async () => {
    const long = "x".repeat(50_000);
    const { sandbox, files } = fakeSandbox((cmd) =>
      cmd === "slow" ? { timedOut: true } : { exitCode: 1, stderr: long },
    );
    files.set("output/a.txt", text("a"));
    const { driver, sent } = fakeDriver([
      turn([
        { id: "a", name: "bash", input: { command: "bad" } },
        { id: "b", name: "bash", input: { command: "slow", timeout_seconds: 9999 } },
        { id: "c", name: "bash", input: {} },
      ]),
      turn([{ id: "h", name: "hand_in", input: { files: ["a.txt"], notes: "" } }]),
    ]);
    await runToolLoop(driver, async () => sandbox, base);
    const [bad, slow, empty] = sent[1]?.results ?? [];
    expect(bad?.isError).toBe(true);
    expect(bad?.content).toContain("Exit code 1.");
    expect(bad?.content).toContain("characters cut");
    expect(bad?.content.length).toBeLessThan(13_000);
    expect(slow).toMatchObject({ content: "Timed out.", isError: true });
    expect(empty).toMatchObject({ content: "bash needs a command.", isError: true });
  });

  it("nudges a model that stops early, then gives up; always closes the sandbox", async () => {
    const { sandbox } = fakeSandbox();
    const { driver, sent } = fakeDriver([turn([], "end"), turn([], "end"), turn([], "end")]);
    await expect(runToolLoop(driver, async () => sandbox, base)).rejects.toThrow(
      "stopped before finishing",
    );
    expect(sent[1]?.text).toContain("call hand_in");
    expect(sandbox.closed).toBe(true);
  });

  it("stops on a refusal and on the turn limit with final errors", async () => {
    const refused = fakeSandbox().sandbox;
    const err = await runToolLoop(
      fakeDriver([turn([], "refusal")]).driver,
      async () => refused,
      base,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toContain("declined");

    const busy = fakeSandbox().sandbox;
    const loop = Array.from({ length: 3 }, (_, i) =>
      turn([{ id: `b${i}`, name: "bash", input: { command: "ls" } }]),
    );
    await expect(
      runToolLoop(fakeDriver(loop).driver, async () => busy, { ...base, maxTurns: 3 }),
    ).rejects.toThrow("ran out of steps");
    expect(busy.closed).toBe(true);
  });
});

describe("clip", () => {
  it("keeps short text and cuts the middle of long text", () => {
    expect(clip("short")).toBe("short");
    const cut = clip(`${"a".repeat(100)}${"b".repeat(100)}`, 20);
    expect(cut.startsWith("a".repeat(10))).toBe(true);
    expect(cut.endsWith("b".repeat(10))).toBe(true);
    expect(cut).toContain("[180 characters cut]");
  });
});
