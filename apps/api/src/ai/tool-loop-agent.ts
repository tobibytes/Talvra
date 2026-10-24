import { GenerationError } from "./claude.js";
import {
  type AgentInput,
  type AgentResult,
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
 * "Do my homework" with any model in a sandbox we run (docs/v2/SANDBOX.md). Not wired into
 * production yet: `homework/agent-deps.ts` still picks `anthropicSandboxAgent`.
 *
 * The loop owns the client tools (bash, download_file, hand_in / verification_result). A
 * `ModelDriver` adapts one provider (Claude, OpenAI, ...) and keeps that provider's native
 * conversation; a `Sandbox` runs commands and holds the files.
 */

export type ToolCall = { id: string; name: string; input: unknown };
export type ToolResult = { callId: string; content: string; isError?: boolean };

export type ModelTurn = {
  text: string;
  /** Client tool calls to answer. Empty: the model stopped. */
  calls: ToolCall[];
  stop: "tool_calls" | "end" | "refusal" | "max_tokens";
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearches?: number };
  /** Progress lines for tools the provider ran itself (e.g. its own web search). */
  activity?: string[];
};

/** One conversation with a model. The first send carries the prompt. */
export type ModelSession = {
  send(message: { text?: string; results?: ToolResult[] }): Promise<ModelTurn>;
};

export type ModelDriver = {
  start(opts: { system: string; tools: ToolSpec[]; model?: string }): ModelSession;
};

export type ExecResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean };

/**
 * One run's isolated workspace. Paths are relative to it: `input/` is $INPUT_DIR, `output/`
 * is $OUTPUT_DIR. Opened per run and closed (destroyed) at the end.
 */
export type Sandbox = {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exec(command: string, opts: { timeoutMs: number }): Promise<ExecResult>;
  /** File names in $OUTPUT_DIR. */
  listOutputs(): Promise<string[]>;
  close(): Promise<void>;
};

export const BASH_SPEC: ToolSpec = {
  name: "bash",
  description:
    "Run a shell command in the sandbox (working directory /work; $INPUT_DIR and $OUTPUT_DIR are set). Returns stdout, stderr and the exit code, shortened when long. Files persist between calls.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 600, description: "Default 120" },
    },
    required: ["command"],
  },
};

const DOWNLOAD_SPEC = downloadSpec(
  "Download a file (dataset, PDF, starter code, zip) from an https URL into $INPUT_DIR.",
);

/** Per stream: enough to debug, small enough to keep the conversation affordable. */
export const MAX_STREAM_CHARS = 12_000;

export function clip(text: string, max = MAX_STREAM_CHARS): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… [${text.length - max} characters cut] …\n${text.slice(-half)}`;
}

export function formatExec(r: ExecResult): string {
  return [
    r.timedOut ? "Timed out." : `Exit code ${r.exitCode}.`,
    r.stdout ? `<stdout>\n${clip(r.stdout)}\n</stdout>` : "",
    r.stderr ? `<stderr>\n${clip(r.stderr)}\n</stderr>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const toolLoopAgent = (
  driver: ModelDriver,
  openSandbox: () => Promise<Sandbox>,
): HomeworkAgent => ({
  kind: "tool-loop",
  run: (input) => runToolLoop(driver, openSandbox, input),
});

export async function runToolLoop(
  driver: ModelDriver,
  openSandbox: () => Promise<Sandbox>,
  input: AgentInput,
): Promise<AgentResult> {
  const verifying = input.mode === "verify";
  const finish = finishInstruction(input.mode);
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const deadline = input.deadline ?? Date.now() + DEFAULT_DEADLINE_MS;
  const progress = async (t: string) => {
    await input.onProgress?.(t);
  };
  const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0, turns: 0 };
  const fetchFile = downloadBudget(input);

  await progress("Starting the sandbox");
  const sandbox = await openSandbox();
  try {
    await progress("Uploading the assignment files");
    await sandbox.writeFile(`input/${NBBUILD_NAME}`, new TextEncoder().encode(NBBUILD_PY));
    for (const f of input.inputs) await sandbox.writeFile(`input/${f.name}`, f.data);

    const session = driver.start({
      system: systemFor(input.system, input.mode),
      tools: [BASH_SPEC, DOWNLOAD_SPEC, verifying ? VERIFY_SPEC : HAND_IN_SPEC],
      model: input.model,
    });
    const names = [...input.inputs.map((f) => f.name), NBBUILD_NAME];
    let next: { text?: string; results?: ToolResult[] } = {
      text: `${input.prompt}\n\n<sandbox>\nFiles in $INPUT_DIR: ${names.join(", ")}.\n${finish}\n</sandbox>`,
    };
    let nudges = 0;

    while (usage.turns < maxTurns) {
      if (Date.now() > deadline)
        throw new GenerationError(false, "This took too long and was stopped. Try again.");
      usage.turns++;
      await progress(usage.turns === 1 ? "Reading the assignment" : "Thinking");
      const turn = await session.send(next);
      usage.inputTokens += turn.usage.inputTokens;
      usage.outputTokens += turn.usage.outputTokens;
      usage.webSearches += turn.usage.webSearches ?? 0;
      for (const line of turn.activity ?? []) await progress(line);

      if (turn.stop === "refusal")
        throw new GenerationError(false, "The AI declined to do this assignment.");
      if (!turn.calls.length) {
        if (nudges++ >= 2)
          throw new GenerationError(false, "The AI stopped before finishing this request.");
        next = { text: finish };
        continue;
      }

      const results: ToolResult[] = [];
      const fail = (callId: string, content: string) =>
        results.push({ callId, content, isError: true });
      for (const call of turn.calls) {
        if (call.name === "bash") {
          const args = call.input as { command?: unknown; timeout_seconds?: unknown };
          if (typeof args?.command !== "string" || !args.command.trim()) {
            fail(call.id, "bash needs a command.");
            continue;
          }
          await progress(describeCommand(args.command));
          const seconds =
            typeof args.timeout_seconds === "number"
              ? Math.min(Math.max(args.timeout_seconds, 1), 600)
              : 120;
          // Never past the run's deadline.
          const timeoutMs = Math.max(1000, Math.min(seconds * 1000, deadline - Date.now()));
          try {
            const r = await sandbox.exec(args.command, { timeoutMs });
            results.push({
              callId: call.id,
              content: formatExec(r),
              isError: r.timedOut || r.exitCode !== 0,
            });
          } catch (err) {
            fail(call.id, err instanceof Error ? err.message : "The command failed to run.");
          }
          continue;
        }
        if (call.name === "download_file") {
          const got = await fetchFile(call.input);
          if (!got.ok) {
            fail(call.id, got.error);
            continue;
          }
          try {
            await sandbox.writeFile(`input/${got.file.name}`, got.file.data);
            results.push({
              callId: call.id,
              content: `Saved ${got.file.name} (${got.file.data.byteLength} bytes) to $INPUT_DIR.`,
            });
          } catch (err) {
            fail(call.id, err instanceof Error ? err.message : "The download failed.");
          }
          continue;
        }
        if (verifying && call.name === "verification_result") {
          const checked = checkVerification(call.input);
          if (checked.ok)
            return {
              files: [],
              notes: checked.report.summary,
              verification: checked.report,
              model: turn.model,
              usage,
            };
          fail(call.id, checked.error);
          continue;
        }
        if (call.name !== "hand_in" || verifying) {
          fail(call.id, "Unknown tool.");
          continue;
        }
        const handIn = checkHandIn(call.input, await sandbox.listOutputs(), input.mode);
        if (!handIn.ok) {
          fail(call.id, handIn.error);
          continue;
        }
        await progress("Collecting your files");
        const files = [];
        for (const name of handIn.files) {
          files.push({ name, data: await sandbox.readFile(`output/${name}`) });
        }
        return { files, notes: handIn.notes, model: turn.model, usage };
      }
      next = { results };
    }
    throw new GenerationError(false, "The AI ran out of steps before finishing. Try again.");
  } finally {
    // The sandbox is per run; destroying it deletes the student's files with it.
    await sandbox.close().catch(() => {});
  }
}
