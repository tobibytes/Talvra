import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { type ClaudeTurn, claudeDriver } from "../src/ai/claude-driver.js";
import { HAND_IN_SPEC } from "../src/ai/homework-agent.js";
import { BASH_SPEC } from "../src/ai/tool-loop-agent.js";

type Params = Parameters<ClaudeTurn>[0];

const msg = (content: unknown[], stop_reason = "tool_use", extra = {}) =>
  ({
    content,
    stop_reason,
    model: "claude-opus-5-5",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, ...extra },
  }) as unknown as Anthropic.Beta.BetaMessage;

function fake(script: Anthropic.Beta.BetaMessage[]) {
  const calls: Params[] = [];
  const turn: ClaudeTurn = async (p) => {
    calls.push(structuredClone(p));
    const next = script.shift();
    if (!next) throw new Error("script ran out");
    return next;
  };
  return { turn, calls };
}

const start = (turn: ClaudeTurn) =>
  claudeDriver(turn).start({ system: "sys", tools: [BASH_SPEC, HAND_IN_SPEC] });

describe("Claude driver", () => {
  it("sends our tools as client tools with Anthropic web tools, adaptive thinking and fallbacks", async () => {
    const { turn, calls } = fake([
      msg([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
      ]),
    ]);
    const out = await start(turn).send({ text: "Do it." });
    expect(out).toMatchObject({
      stop: "tool_calls",
      calls: [{ id: "t1", name: "bash", input: { command: "ls" } }],
      usage: { inputTokens: 110, outputTokens: 5 },
    });
    const p = calls[0] as Params;
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "high" });
    expect(p.cache_control).toEqual({ type: "ephemeral" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    const tools = p.tools as { name: string; type?: string; eager_input_streaming?: boolean }[];
    expect(tools.map((t) => t.name)).toEqual(["bash", "hand_in", "web_search", "web_fetch"]);
    expect(tools[0]?.eager_input_streaming).toBe(true);
    expect(tools[2]?.type).toBe("web_search_20260209");
  });

  it("keeps the conversation append-only and returns results (images too) as tool_result blocks", async () => {
    const first = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
    ];
    const { turn, calls } = fake([msg(first), msg([{ type: "text", text: "Done." }], "end_turn")]);
    const session = start(turn);
    await session.send({ text: "Go." });
    const out = await session.send({
      results: [
        {
          callId: "t1",
          content: [
            { type: "image", mediaType: "image/png", data: "AAAA" },
            { type: "text", text: "shot.png" },
          ],
        },
      ],
    });
    expect(out).toMatchObject({ stop: "end", calls: [], text: "Done." });
    const second = calls[1]?.messages ?? [];
    // The earlier turns are resent exactly, thinking block included.
    expect(second[0]).toEqual(calls[0]?.messages[0]);
    expect(second[1]).toEqual({ role: "assistant", content: first });
    expect(second[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            { type: "text", text: "shot.png" },
          ],
        },
      ],
    });
  });

  it("continues a paused turn and reports server-side searches as activity", async () => {
    const { turn, calls } = fake([
      msg(
        [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "big-o" } }],
        "pause_turn",
        { server_tool_use: { web_search_requests: 1 } },
      ),
      msg([{ type: "tool_use", id: "t2", name: "hand_in", input: {} }]),
    ]);
    const out = await start(turn).send({ text: "Go." });
    expect(calls).toHaveLength(2);
    expect(out.activity).toEqual(["Searching the web: big-o"]);
    expect(out.usage.webSearches).toBe(1);
    expect(out.calls.map((c) => c.id)).toEqual(["t2"]);
  });

  it("runs nothing from a cut-off turn and answers its calls with errors on the next send", async () => {
    const { turn, calls } = fake([
      msg([{ type: "tool_use", id: "t1", name: "bash", input: { command: "echo" } }], "max_tokens"),
      msg([{ type: "text", text: "ok" }], "end_turn"),
    ]);
    const session = start(turn);
    const cut = await session.send({ text: "Go." });
    expect(cut).toMatchObject({ stop: "max_tokens", calls: [] });
    await session.send({ text: "Finish up." });
    const user = calls[1]?.messages[2];
    expect(user?.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true }),
      { type: "text", text: "Finish up." },
    ]);
  });

  it("reports a refusal", async () => {
    const { turn } = fake([msg([], "refusal")]);
    expect((await start(turn).send({ text: "x" })).stop).toBe("refusal");
  });
});
