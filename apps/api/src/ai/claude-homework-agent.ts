import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { z } from "zod";
import { GenerationError, OPUS, toGenerationError } from "./claude.js";
import { NBBUILD_PY } from "./nbbuild-source.js";

/**
 * "Do my homework" agent (owner-only feature). Claude works in Anthropic's code-execution
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

export type AgentInput = {
  system: string;
  prompt: string;
  /** Files copied into the sandbox ($INPUT_DIR): the assignment's PDFs, datasets, etc. */
  inputs: { name: string; data: Uint8Array; contentType: string }[];
  model?: string;
  maxTurns?: number;
  deadline?: number;
  onProgress?: (text: string) => Promise<void> | void;
};

export type AgentResult = {
  files: { name: string; data: Uint8Array }[];
  notes: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearches: number; turns: number };
};

const HandIn = z.object({
  files: z.array(z.string().min(1)).min(1),
  notes: z.string(),
});

const HAND_IN: Anthropic.Tool = {
  name: "hand_in",
  description:
    "Call once, at the very end, when every file to hand in is saved in $OUTPUT_DIR. Give their file names (no paths) and notes for the student: what each file contains, assumptions, and anything to check before submitting.",
  input_schema: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" }, description: "File names in $OUTPUT_DIR" },
      notes: { type: "string" },
    },
    required: ["files", "notes"],
  },
};

// Server tools. The 2025 web versions, because the 2026 ones bring their own code sandbox,
// and a second one next to code_execution confuses the model.
const TOOLS: Anthropic.ToolUnion[] = [
  { type: "code_execution_20260120", name: "code_execution" },
  { type: "web_search_20250305", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 10 },
  HAND_IN,
];

const base = (name: string) => name.split("/").pop()?.trim() ?? name;

/** A short, human line for what the agent is doing (shown live on the page). */
function describe(block: Anthropic.ServerToolUseBlock): string {
  const input = block.input as Record<string, unknown>;
  if (block.name === "web_search")
    return `Searching the web: ${String(input.query ?? "").slice(0, 80)}`;
  if (block.name === "web_fetch") return `Reading ${String(input.url ?? "a page").slice(0, 80)}`;
  const cmd = String(input.command ?? input.code ?? "");
  if (/nbbuild\.py/.test(cmd)) return "Running the notebook";
  if (/\bpython\b/.test(cmd)) return "Running Python";
  if (block.name.startsWith("text_editor")) return "Writing files";
  return "Working in the sandbox";
}

export async function runHomeworkAgent(api: AgentApi, input: AgentInput): Promise<AgentResult> {
  const model = input.model ?? OPUS;
  const maxTurns = input.maxTurns ?? 30;
  const deadline = input.deadline ?? Date.now() + 12 * 60_000;
  const progress = async (t: string) => {
    await input.onProgress?.(t);
  };
  const uploaded: string[] = [];
  const outputs = new Map<string, string>(); // file name in $OUTPUT_DIR -> file id
  const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0, turns: 0 };

  try {
    await progress("Uploading the assignment files");
    const helper = await api.upload(
      "nbbuild.py",
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
            text: `${input.prompt}\n\n<sandbox>\nFiles in $INPUT_DIR: ${[...names, "nbbuild.py"].join(", ")}.\nSave every file to hand in to $OUTPUT_DIR, then call hand_in.\n</sandbox>`,
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
        system: input.system,
        thinking: { type: "adaptive" },
        tools: TOOLS,
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
            outputs.set(base(await api.filename(out.file_id)), out.file_id);
          }
        }
      }
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "pause_turn") continue; // server tools hit their loop limit
      if (msg.stop_reason === "refusal")
        throw new GenerationError(false, "Claude declined to do this assignment.");

      const call = msg.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "hand_in",
      );
      if (!call) {
        if (nudges++ >= 2)
          throw new GenerationError(false, "The AI stopped without handing in files.");
        messages.push({
          role: "user",
          content: "Save the files to hand in to $OUTPUT_DIR and call hand_in.",
        });
        continue;
      }
      const parsed = HandIn.safeParse(call.input);
      const wanted = parsed.success ? parsed.data.files.map(base) : [];
      const missing = wanted.filter((n) => !outputs.has(n));
      if (!parsed.success || missing.length) {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content: parsed.success
                ? `Not found in $OUTPUT_DIR: ${missing.join(", ")}. Files there: ${[...outputs.keys()].join(", ") || "none"}. Save them with a bash command (e.g. cp file "$OUTPUT_DIR/") and call hand_in again.`
                : "hand_in needs files (names) and notes.",
            },
          ],
        });
        continue;
      }
      await progress("Collecting your files");
      const files = [];
      for (const name of wanted) {
        files.push({ name, data: await api.download(outputs.get(name) as string) });
      }
      return { files, notes: parsed.data.notes, model: msg.model, usage };
    }
    throw new GenerationError(false, "The AI ran out of steps before finishing. Try again.");
  } finally {
    // Best effort: don't leave the student's files on Anthropic's side.
    await Promise.all([...uploaded, ...outputs.values()].map((id) => api.remove(id)));
  }
}
