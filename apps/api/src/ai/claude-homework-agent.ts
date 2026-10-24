import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { VerificationResult } from "@talvra/contracts";
import { z } from "zod";
import { GenerationError, OPUS, toGenerationError } from "./claude.js";
import { NBBUILD_PY } from "./nbbuild-source.js";

/**
 * "Do my homework" agent for signed-in accounts. Claude works in Anthropic's code-execution
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
  mode?: "generate" | "revise" | "verify";
  maxTurns?: number;
  deadline?: number;
  onProgress?: (text: string) => Promise<void> | void;
  /** Fetches a URL for download_file (done by our server; the sandbox has no internet). */
  fetchUrl?: (url: string) => Promise<{ name: string; data: Uint8Array; contentType: string }>;
};

const MAX_DOWNLOADS = 10;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

const DOWNLOAD: Anthropic.Tool = {
  name: "download_file",
  description:
    "Download a file (dataset, PDF, starter code, zip) from an https URL into $INPUT_DIR. The sandbox has no internet; this is the only way to get files from the web. For reading web pages, use web_fetch instead.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "https URL of the file" } },
    required: ["url"],
  },
};

export type AgentResult = {
  files: { name: string; data: Uint8Array }[];
  notes: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearches: number; turns: number };
  verification?: VerificationResult;
};

const HandIn = z.object({
  files: z.array(z.string().min(1)),
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

const VERIFY: Anthropic.Tool = {
  name: "verification_result",
  description:
    "Finish checking the current draft. Report concrete checks, evidence and anything you could not verify. Do not change the deliverables.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      checks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["passed", "issue", "not_checked"] },
            detail: { type: "string" },
          },
          required: ["name", "status", "detail"],
        },
      },
    },
    required: ["summary", "checks"],
  },
};

// Server tools. The 2025 web versions, because the 2026 ones bring their own code sandbox,
// and a second one next to code_execution confuses the model.
const TOOLS: Anthropic.ToolUnion[] = [
  { type: "code_execution_20260120", name: "code_execution" },
  { type: "web_search_20250305", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20250910", name: "web_fetch", max_uses: 10 },
  DOWNLOAD,
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
  const verifying = input.mode === "verify";
  const finish = verifying
    ? "Check the existing draft and call verification_result. Do not alter the deliverables."
    : "Save every file to hand in to $OUTPUT_DIR, then call hand_in. For a follow-up that only answers a question without changing files, call hand_in with files: [] and your answer in notes.";
  const model = input.model ?? OPUS;
  const maxTurns = input.maxTurns ?? 30;
  const deadline = input.deadline ?? Date.now() + 12 * 60_000;
  const progress = async (t: string) => {
    await input.onProgress?.(t);
  };
  const uploaded: string[] = [];
  const outputs = new Map<string, string>(); // file name in $OUTPUT_DIR -> file id
  const outputIds = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0, turns: 0 };
  let downloads = 0;
  let downloadedBytes = 0;

  /** download_file: our server fetches the file and the sandbox gets it as an upload. */
  const downloadInto = async (
    call: Anthropic.ToolUseBlock,
  ): Promise<{ result: Anthropic.ToolResultBlockParam; fileId?: string }> => {
    const fail = (content: string) => ({
      result: { type: "tool_result" as const, tool_use_id: call.id, is_error: true, content },
    });
    const parsed = z.object({ url: z.string().url() }).safeParse(call.input);
    if (!parsed.success) return fail("download_file needs a valid URL.");
    const url = parsed.data.url;
    if (!input.fetchUrl) return fail("Downloads aren't available in this run.");
    if (downloads >= MAX_DOWNLOADS)
      return fail(`Limit of ${MAX_DOWNLOADS} downloads per run reached.`);
    downloads++;
    await progress(`Downloading ${url.slice(0, 80)}`);
    try {
      const file = await input.fetchUrl(url);
      if (downloadedBytes + file.data.byteLength > MAX_DOWNLOAD_BYTES)
        return fail("That would go over this run's download limit.");
      downloadedBytes += file.data.byteLength;
      const fileId = await api.upload(file.name, file.data, file.contentType);
      uploaded.push(fileId);
      return {
        result: {
          type: "tool_result",
          tool_use_id: call.id,
          content: `Saved ${file.name} (${file.data.byteLength} bytes) to $INPUT_DIR.`,
        },
        fileId,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The download failed.");
    }
  };

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
            text: `${input.prompt}\n\n<sandbox>\nFiles in $INPUT_DIR: ${[...names, "nbbuild.py"].join(", ")}.\n${finish}\n</sandbox>`,
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
        system: verifying
          ? `${input.system}\n\nThis run is verification only. Inspect and execute copies of the current files, report evidence using verification_result, and do not hand in replacements.`
          : input.system,
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
            outputs.set(base(await api.filename(out.file_id)), out.file_id);
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
          const parsed = VerificationResult.safeParse(call.input);
          if (parsed.success)
            return {
              files: [],
              notes: parsed.data.summary,
              verification: parsed.data,
              model: msg.model,
              usage,
            };
          reply.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content:
              "Provide a summary and at least one check with name, status (passed, issue, not_checked), and detail.",
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
        const parsed = HandIn.safeParse(call.input);
        const wanted = parsed.success ? parsed.data.files.map(base) : [];
        const missing = wanted.filter((n) => !outputs.has(n));
        if (!parsed.success || missing.length || (!wanted.length && input.mode !== "revise")) {
          reply.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: parsed.success
              ? `Not found in $OUTPUT_DIR: ${missing.join(", ")}. Files there: ${[...outputs.keys()].join(", ") || "none"}. Save them with a bash command (e.g. cp file "$OUTPUT_DIR/") and call hand_in again.`
              : "hand_in needs files (names) and notes.",
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
      // Tool results must precede other content in the user message.
      messages.push({ role: "user", content: [...reply, ...newUploads] });
    }
    throw new GenerationError(false, "The AI ran out of steps before finishing. Try again.");
  } finally {
    // Best effort: don't leave the student's files on Anthropic's side.
    await Promise.allSettled([...uploaded, ...outputIds].map((id) => api.remove(id)));
  }
}
