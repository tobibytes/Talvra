import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { GenerationError, OPUS, toGenerationError } from "./claude.js";
import {
  type AgentInput,
  type AgentResult,
  baseName,
  checkHandIn,
  checkVerification,
  DEFAULT_DEADLINE_MS,
  DEFAULT_MAX_TURNS,
  describeCommand,
  downloadBudget,
  downloadSpec,
  finishInstruction,
  HAND_IN_SPEC,
  type HomeworkAgent,
  NBBUILD_NAME,
  systemFor,
  type ToolSpec,
  VERIFY_SPEC,
} from "./homework-agent.js";
import { NBBUILD_PY } from "./nbbuild-source.js";

/**
 * The production "Do my homework" agent (see ai/homework-agent.ts). Claude works in Anthropic's code-execution
 * sandbox (Python + data libraries, no internet) with the assignment's files uploaded, can
 * search and read the web (server tools, run by Anthropic), and finishes by calling `hand_in`
 * with the files it saved to $OUTPUT_DIR. Nothing here runs on our servers but the loop.
 */

/** What the loop needs from Anthropic. Tests swap in a fake. */
export type AgentApi = {
  upload(name: string, data: Uint8Array, contentType: string): Promise<string>;
  download(fileId: string): Promise<Uint8Array>;
  filename(fileId: string): Promise<string>;
  remove(fileId: string): Promise<void>;
  turn(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
};

export function anthropicAgentApi(apiKey: string, ownKey = false): AgentApi {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const wrap = async <T>(p: Promise<T>) => {
    try {
      return await p;
    } catch (err) {
      throw toGenerationError(err, ownKey);
    }
  };
  return {
    upload: async (name, data, contentType) =>
      (await wrap(client.files.upload({ file: await toFile(data, name, { type: contentType }) })))
        .id,
    download: async (id) =>
      new Uint8Array(await (await wrap(client.files.download(id))).arrayBuffer()),
    filename: async (id) => (await wrap(client.files.retrieveMetadata(id))).filename,
    remove: async (id) => {
      await client.files.delete(id).catch(() => {});
    },
    // Streamed (long turns) and collected; the loop only needs the final message.
    turn: (params) => wrap(client.messages.stream(params).finalMessage()),
  };
}

export type { AgentInput, AgentResult } from "./homework-agent.js";

/** Today's agent: Claude in Anthropic's code-execution sandbox. */
export const anthropicSandboxAgent = (api: AgentApi): HomeworkAgent => ({
  kind: "anthropic-sandbox",
  run: (input) => runHomeworkAgent(api, input),
});

const tool = (spec: ToolSpec): Anthropic.Tool => ({
  name: spec.name,
  description: spec.description,
  input_schema: spec.parameters,
});

const DOWNLOAD = tool(
  downloadSpec(
    "Download a file (dataset, PDF, starter code, zip) from an https URL into $INPUT_DIR. The sandbox has no internet; this is the only way to get files from the web. For reading web pages, use web_fetch instead.",
  ),
);
const HAND_IN = tool(HAND_IN_SPEC);
const VERIFY = tool(VERIFY_SPEC);

// Server tools. The 2025 web versions, because the 2026 ones bring their own code sandbox,
// and a second one next to code_execution confuses the model.
const TOOLS: Anthropic.ToolUnion[] = [
  { type: "code_execution_20260120", name: "code_execution" },
  { type: "web_search_20250305", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 10 },
  DOWNLOAD,
];

/** A short, human line for what the agent is doing (shown live on the page). */
function describe(block: Anthropic.ServerToolUseBlock): string {
  const input = block.input as Record<string, unknown>;
  if (block.name === "web_search")
    return `Searching the web: ${String(input.query ?? "").slice(0, 80)}`;
  if (block.name === "web_fetch") return `Reading ${String(input.url ?? "a page").slice(0, 80)}`;
  if (block.name.startsWith("text_editor")) return "Writing files";
  return describeCommand(String(input.command ?? input.code ?? ""));
}

export async function runHomeworkAgent(api: AgentApi, input: AgentInput): Promise<AgentResult> {
  const verifying = input.mode === "verify";
  const finish = finishInstruction(input.mode);
  const model = input.model ?? OPUS;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const deadline = input.deadline ?? Date.now() + DEFAULT_DEADLINE_MS;
  const progress = async (t: string) => {
    await input.onProgress?.(t);
  };
  const uploaded: string[] = [];
  const outputs = new Map<string, string>(); // file name in $OUTPUT_DIR -> file id
  const outputIds = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0, turns: 0 };
  const fetchFile = downloadBudget(input);

  /** download_file: our server fetches the file and the sandbox gets it as an upload. */
  const downloadInto = async (
    call: Anthropic.ToolUseBlock,
  ): Promise<{ result: Anthropic.ToolResultBlockParam; fileId?: string }> => {
    const got = await fetchFile(call.input);
    if (!got.ok)
      return {
        result: { type: "tool_result", tool_use_id: call.id, is_error: true, content: got.error },
      };
    try {
      const fileId = await api.upload(got.file.name, got.file.data, got.file.contentType);
      uploaded.push(fileId);
      return {
        result: {
          type: "tool_result",
          tool_use_id: call.id,
          content: `Saved ${got.file.name} (${got.file.data.byteLength} bytes) to $INPUT_DIR.`,
        },
        fileId,
      };
    } catch (err) {
      const content = err instanceof Error ? err.message : "The download failed.";
      return { result: { type: "tool_result", tool_use_id: call.id, is_error: true, content } };
    }
  };

  try {
    await progress("Uploading the assignment files");
    const helper = await api.upload(
      NBBUILD_NAME,
      new TextEncoder().encode(NBBUILD_PY),
      "text/x-python",
    );
    uploaded.push(helper);
    for (const f of input.inputs) uploaded.push(await api.upload(f.name, f.data, f.contentType));

    const names = input.inputs.map((f) => f.name);
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${input.prompt}\n\n<sandbox>\nFiles in $INPUT_DIR: ${[...names, NBBUILD_NAME].join(", ")}.\n${finish}\n</sandbox>`,
          },
          ...uploaded.map((id) => ({ type: "container_upload" as const, file_id: id })),
        ],
      },
    ];
    let container: string | undefined;
    let nudges = 0;

    while (usage.turns < maxTurns) {
      if (Date.now() > deadline)
        throw new GenerationError(false, "This took too long and was stopped. Try again.");
      usage.turns++;
      await progress(usage.turns === 1 ? "Reading the assignment" : "Thinking");
      const msg = await api.turn({
        model,
        max_tokens: 32000,
        system: systemFor(input.system, input.mode),
        thinking: { type: "adaptive" },
        tools: [...TOOLS, verifying ? VERIFY : HAND_IN],
        messages,
        ...(container ? { container } : {}),
      });
      container = msg.container?.id ?? container;
      usage.inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0);
      usage.outputTokens += msg.usage.output_tokens;
      usage.webSearches += msg.usage.server_tool_use?.web_search_requests ?? 0;

      for (const block of msg.content) {
        if (block.type === "server_tool_use") await progress(describe(block));
        if (
          block.type === "bash_code_execution_tool_result" &&
          block.content.type === "bash_code_execution_result"
        ) {
          for (const out of block.content.content) {
            outputIds.add(out.file_id);
            outputs.set(baseName(await api.filename(out.file_id)), out.file_id);
          }
        }
      }
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "pause_turn") continue; // server tools hit their loop limit
      if (msg.stop_reason === "refusal")
        throw new GenerationError(false, "Claude declined to do this assignment.");

      const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!calls.length) {
        if (nudges++ >= 2)
          throw new GenerationError(false, "The AI stopped before finishing this request.");
        messages.push({
          role: "user",
          content: finish,
        });
        continue;
      }
      // Answer every client tool call in one user turn (new files ride along as uploads).
      const reply: Anthropic.ContentBlockParam[] = [];
      const newUploads: Anthropic.ContentBlockParam[] = [];
      for (const call of calls) {
        if (call.name === "download_file") {
          const r = await downloadInto(call);
          reply.push(r.result);
          if (r.fileId) newUploads.push({ type: "container_upload", file_id: r.fileId });
          continue;
        }
        if (verifying && call.name === "verification_result") {
          const checked = checkVerification(call.input);
          if (checked.ok)
            return {
              files: [],
              notes: checked.report.summary,
              verification: checked.report,
              model: msg.model,
              usage,
            };
          reply.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: checked.error,
          });
          continue;
        }
        if (call.name !== "hand_in" || verifying) {
          reply.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: "Unknown tool.",
          });
          continue;
        }
        const handIn = checkHandIn(call.input, outputs.keys(), input.mode);
        if (!handIn.ok) {
          reply.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: handIn.error,
          });
          continue;
        }
        await progress("Collecting your files");
        const files = [];
        for (const name of handIn.files) {
          files.push({ name, data: await api.download(outputs.get(name) as string) });
        }
        return { files, notes: handIn.notes, model: msg.model, usage };
      }
      // Tool results must precede other content in the user message.
      messages.push({ role: "user", content: [...reply, ...newUploads] });
    }
    throw new GenerationError(false, "The AI ran out of steps before finishing. Try again.");
  } finally {
    // Best effort: don't leave the student's files on Anthropic's side.
    await Promise.allSettled([...uploaded, ...outputIds].map((id) => api.remove(id)));
  }
}
