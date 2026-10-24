import Anthropic from "@anthropic-ai/sdk";
import { OPUS, toGenerationError } from "./claude.js";
import type { ToolSpec } from "./homework-agent.js";
import type { ModelDriver, ModelTurn, ToolResult } from "./tool-loop-agent.js";

/**
 * Claude as a `ModelDriver` for our own sandbox (docs/v2/SANDBOX.md, phase 4). Our tools run as
 * client tools; web search and fetch stay Anthropic server tools. The conversation is
 * append-only (thinking blocks are passed back untouched), cached automatically, and asks for
 * Anthropic's server-side refusal fallback so a declined turn is retried on another model.
 */

type Params = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
/** One API call. Tests swap in a fake. */
export type ClaudeTurn = (params: Params) => Promise<Anthropic.Beta.BetaMessage>;

export function anthropicClaudeTurn(apiKey: string, ownKey = false): ClaudeTurn {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return async (params) => {
    try {
      // Streamed (long turns, large max_tokens) and collected.
      return await client.beta.messages.stream(params).finalMessage();
    } catch (err) {
      throw toGenerationError(err, ownKey);
    }
  };
}

const SERVER_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
];

/** Max tokens per turn (streamed, so a large cap is safe). */
const MAX_TOKENS = 32_000;

function toBlocks(r: ToolResult): Anthropic.Beta.BetaToolResultBlockParam {
  const content =
    typeof r.content === "string"
      ? r.content
      : r.content.map((c) =>
          c.type === "text"
            ? ({ type: "text", text: c.text } as const)
            : ({
                type: "image",
                source: { type: "base64", media_type: c.mediaType, data: c.data },
              } as const),
        );
  return { type: "tool_result", tool_use_id: r.callId, content, is_error: r.isError || undefined };
}

function activityLine(block: Anthropic.Beta.BetaServerToolUseBlock): string | null {
  const input = block.input as Record<string, unknown>;
  if (block.name === "web_search")
    return `Searching the web: ${String(input.query ?? "").slice(0, 80)}`;
  if (block.name === "web_fetch") return `Reading ${String(input.url ?? "a page").slice(0, 80)}`;
  return null;
}

export function claudeDriver(turn: ClaudeTurn): ModelDriver {
  return {
    start({ system, tools, model }) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [];
      const clientTools: Anthropic.Beta.BetaTool[] = tools.map((t: ToolSpec) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        // Big inputs (scripts, file contents) stream as they're written; the loop validates them.
        eager_input_streaming: true,
      }));
      // tool_use ids from the last assistant turn that still need a result.
      let pending: string[] = [];

      return {
        async send({ text, results = [] }) {
          // Every tool_use must get a result, even ones the loop didn't run (e.g. a call cut off
          // by max_tokens), or the next request is rejected.
          const answered = new Set(results.map((r) => r.callId));
          const content: Anthropic.Beta.BetaContentBlockParam[] = [
            ...results.map(toBlocks),
            ...pending
              .filter((id) => !answered.has(id))
              .map(
                (id): Anthropic.Beta.BetaToolResultBlockParam => ({
                  type: "tool_result",
                  tool_use_id: id,
                  is_error: true,
                  content: "This call wasn't run (the reply was cut off). Send it again if needed.",
                }),
              ),
            ...(text ? [{ type: "text" as const, text }] : []),
          ];
          messages.push({ role: "user", content });

          const out: ModelTurn = {
            text: "",
            calls: [],
            stop: "end",
            model: model ?? OPUS,
            usage: { inputTokens: 0, outputTokens: 0, webSearches: 0 },
            activity: [],
          };
          // pause_turn: server tools hit their per-turn loop limit; continue the same turn.
          for (let rounds = 0; rounds < 5; rounds++) {
            const msg = await turn({
              model: model ?? OPUS,
              max_tokens: MAX_TOKENS,
              system,
              thinking: { type: "adaptive" },
              output_config: { effort: "high" },
              tools: [...clientTools, ...SERVER_TOOLS],
              messages,
              cache_control: { type: "ephemeral" },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            });
            // Append the content untouched (thinking, server tool results, fallback blocks).
            messages.push({ role: "assistant", content: msg.content });
            out.model = msg.model;
            out.usage.inputTokens +=
              msg.usage.input_tokens +
              (msg.usage.cache_read_input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0);
            out.usage.outputTokens += msg.usage.output_tokens;
            out.usage.webSearches =
              (out.usage.webSearches ?? 0) + (msg.usage.server_tool_use?.web_search_requests ?? 0);
            for (const block of msg.content) {
              if (block.type === "text") out.text += block.text;
              if (block.type === "server_tool_use") {
                const line = activityLine(block);
                if (line) out.activity?.push(line);
              }
            }
            if (msg.stop_reason === "pause_turn") continue;

            const calls = msg.content.filter(
              (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
            );
            pending = calls.map((c) => c.id);
            if (msg.stop_reason === "refusal") {
              out.stop = "refusal";
            } else if (msg.stop_reason === "max_tokens") {
              // A call may be truncated; don't run anything from this turn.
              out.stop = "max_tokens";
            } else {
              out.calls = calls.map((c) => ({ id: c.id, name: c.name, input: c.input }));
              out.stop = calls.length ? "tool_calls" : "end";
            }
            return out;
          }
          pending = [];
          out.stop = "end";
          return out;
        },
      };
    },
  };
}
