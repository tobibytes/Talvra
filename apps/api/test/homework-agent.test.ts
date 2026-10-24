import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { type AgentApi, runHomeworkAgent } from "../src/ai/claude-homework-agent.js";

const message = (content: unknown[], stop_reason = "tool_use") =>
  ({
    content,
    stop_reason,
    container: { id: "sandbox" },
    model: "test",
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as Anthropic.Message;
const call = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const output = (id: string) => ({
  type: "bash_code_execution_tool_result",
  tool_use_id: "exec",
  content: {
    type: "bash_code_execution_result",
    content: [{ type: "bash_code_execution_output", file_id: id }],
  },
});
function fake(script: Anthropic.Message[]) {
  const turns: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const api: AgentApi = {
    upload: vi.fn(async (name) => `uploaded_${name}`),
    download: vi.fn(async () => new TextEncoder().encode("answer")),
    filename: vi.fn(async () => "answer.txt"),
    remove: vi.fn(async () => {}),
    turn: async (p) => {
      turns.push(structuredClone(p));
      const next = script.shift();
      if (!next) throw new Error("Unexpected turn");
      return next;
    },
  };
  return { api, turns };
}
const handIn = call("hand", "hand_in", { files: ["answer.txt"], notes: "Done" });

describe("homework sandbox tool loop", () => {
  it("returns a structured verification report without handing in files", async () => {
    const report = {
      summary: "Needs an explanation",
      checks: [{ name: "Rubric", status: "issue", detail: "Question 2 has no explanation." }],
    };
    const { api, turns } = fake([message([call("v", "verification_result", report)])]);
    const out = await runHomeworkAgent(api, {
      system: "test",
      prompt: "verify",
      inputs: [],
      mode: "verify",
    });
    expect(out.verification).toEqual(report);
    expect(out.files).toEqual([]);
    expect(api.download).not.toHaveBeenCalled();
    expect(turns[0]?.tools?.map((t) => ("name" in t ? t.name : undefined))).toContain(
      "verification_result",
    );
    expect(turns[0]?.tools?.map((t) => ("name" in t ? t.name : undefined))).not.toContain(
      "hand_in",
    );
  });

  it("answers a follow-up without replacing files when no edits are needed", async () => {
    const { api } = fake([
      message([
        call("a", "hand_in", { files: [], notes: "The coefficient is the change per unit." }),
      ]),
    ]);
    const out = await runHomeworkAgent(api, {
      system: "test",
      prompt: "explain",
      inputs: [],
      mode: "revise",
    });
    expect(out.files).toEqual([]);
    expect(out.notes).toContain("change per unit");
  });
  it("downloads and uploads resources, answers every client call, and reuses the sandbox", async () => {
    const { api, turns } = fake([
      message([
        call("d1", "download_file", { url: "https://example.org/data.csv" }),
        call("d2", "download_file", null),
      ]),
      message([output("result"), handIn]),
    ]);
    const fetchUrl = vi.fn(async () => ({
      name: "data.csv",
      contentType: "text/csv",
      data: new TextEncoder().encode("x\n1"),
    }));
    const result = await runHomeworkAgent(api, {
      system: "test",
      prompt: "test",
      inputs: [],
      fetchUrl,
    });
    expect(result.files[0]?.name).toBe("answer.txt");
    expect(fetchUrl).toHaveBeenCalledWith("https://example.org/data.csv");
    expect(turns[1]?.container).toBe("sandbox");
    const reply = turns[1]?.messages.at(-1)?.content;
    expect(Array.isArray(reply) && reply.map((b) => b.type)).toEqual([
      "tool_result",
      "tool_result",
      "container_upload",
    ]);
    expect(reply).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", tool_use_id: "d1" }),
        expect.objectContaining({ type: "tool_result", tool_use_id: "d2", is_error: true }),
        { type: "container_upload", file_id: "uploaded_data.csv" },
      ]),
    );
    expect(api.remove).toHaveBeenCalledWith("uploaded_data.csv");
  });

  it("lets the model recover from a download failure", async () => {
    const { api, turns } = fake([
      message([call("d", "download_file", { url: "https://example.org/data.csv" })]),
      message([output("result"), handIn]),
    ]);
    await runHomeworkAgent(api, {
      system: "test",
      prompt: "test",
      inputs: [],
      fetchUrl: async () => {
        throw new Error("Download returned 404");
      },
    });
    expect(turns[1]?.messages.at(-1)?.content).toContainEqual(
      expect.objectContaining({
        tool_use_id: "d",
        is_error: true,
        content: "Download returned 404",
      }),
    );
  });

  it("cleans up superseded files and does not lose the result when cleanup fails", async () => {
    const { api } = fake([
      message([output("old")], "pause_turn"),
      message([output("new"), handIn]),
    ]);
    vi.mocked(api.remove).mockRejectedValue(new Error("cleanup unavailable"));
    const result = await runHomeworkAgent(api, { system: "test", prompt: "test", inputs: [] });
    expect(result.files).toHaveLength(1);
    expect(api.download).toHaveBeenCalledWith("new");
    expect(api.remove).toHaveBeenCalledWith("old");
    expect(api.remove).toHaveBeenCalledWith("new");
  });
});
