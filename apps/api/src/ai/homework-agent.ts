import { VerificationResult } from "@talvra/contracts";
import { z } from "zod";

/**
 * The "Do my homework" agent, independent of who runs it. `homework/draft.ts` only sees a
 * `HomeworkAgent`. Two implementations:
 * - `anthropicSandboxAgent` (ai/claude-homework-agent.ts): Claude in Anthropic's code-execution
 *   sandbox. Production today.
 * - `toolLoopAgent` (ai/tool-loop-agent.ts): any model (`ModelDriver`) driving a sandbox we run
 *   (`Sandbox`). Being built; see docs/v2/SANDBOX.md.
 * The client tools (hand_in, verification_result, download_file) and their rules live here so
 * both behave the same.
 */

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
  /** Fetches a URL for download_file (done by our server, never with Canvas credentials). */
  fetchUrl?: (url: string) => Promise<{ name: string; data: Uint8Array; contentType: string }>;
};

export type AgentResult = {
  files: { name: string; data: Uint8Array }[];
  notes: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearches: number; turns: number };
  verification?: VerificationResult;
};

export type HomeworkAgent = {
  /** For logs: which implementation ran. */
  readonly kind: "anthropic-sandbox" | "tool-loop";
  run(input: AgentInput): Promise<AgentResult>;
};

/** A client tool in provider-neutral form (JSON Schema parameters). */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export const MAX_DOWNLOADS = 10;
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_TURNS = 30;
export const DEFAULT_DEADLINE_MS = 12 * 60_000;

export const NBBUILD_NAME = "nbbuild.py";

export const downloadSpec = (description: string): ToolSpec => ({
  name: "download_file",
  description,
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "https URL of the file" } },
    required: ["url"],
  },
});

export const HAND_IN_SPEC: ToolSpec = {
  name: "hand_in",
  description:
    "Call once, at the very end, when every file to hand in is saved in $OUTPUT_DIR. Give their file names (no paths) and notes for the student: what each file contains, assumptions, and anything to check before submitting.",
  parameters: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" }, description: "File names in $OUTPUT_DIR" },
      notes: { type: "string" },
    },
    required: ["files", "notes"],
  },
};

export const VERIFY_SPEC: ToolSpec = {
  name: "verification_result",
  description:
    "Finish checking the current draft. Report concrete checks, evidence and anything you could not verify. Do not change the deliverables.",
  parameters: {
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

/** What the model is told to do to finish, per mode. */
export const finishInstruction = (mode: AgentInput["mode"]) =>
  mode === "verify"
    ? "Check the existing draft and call verification_result. Do not alter the deliverables."
    : "Save every file to hand in to $OUTPUT_DIR, then call hand_in. For a follow-up that only answers a question without changing files, call hand_in with files: [] and your answer in notes.";

export const systemFor = (system: string, mode: AgentInput["mode"]) =>
  mode === "verify"
    ? `${system}\n\nThis run is verification only. Inspect and execute copies of the current files, report evidence using verification_result, and do not hand in replacements.`
    : system;

/** A file name without any directory part. */
export const baseName = (name: string) => name.split("/").pop()?.trim() ?? name;

const HandIn = z.object({
  files: z.array(z.string().min(1)),
  notes: z.string(),
});

/**
 * Checks a hand_in call against the files the sandbox has in $OUTPUT_DIR.
 * ok: the names to collect (bare file names). Otherwise the error to send back to the model.
 */
export function checkHandIn(
  input: unknown,
  available: Iterable<string>,
  mode: AgentInput["mode"],
): { ok: true; files: string[]; notes: string } | { ok: false; error: string } {
  const have = new Set(available);
  const parsed = HandIn.safeParse(input);
  if (!parsed.success) return { ok: false, error: "hand_in needs files (names) and notes." };
  const wanted = parsed.data.files.map(baseName);
  const missing = wanted.filter((n) => !have.has(n));
  // Only a follow-up may hand in nothing (an answer to a question).
  if (missing.length || (!wanted.length && mode !== "revise"))
    return {
      ok: false,
      error: `Not found in $OUTPUT_DIR: ${missing.join(", ")}. Files there: ${[...have].join(", ") || "none"}. Save them with a bash command (e.g. cp file "$OUTPUT_DIR/") and call hand_in again.`,
    };
  return { ok: true, files: wanted, notes: parsed.data.notes };
}

export function checkVerification(
  input: unknown,
): { ok: true; report: VerificationResult } | { ok: false; error: string } {
  const parsed = VerificationResult.safeParse(input);
  return parsed.success
    ? { ok: true, report: parsed.data }
    : {
        ok: false,
        error:
          "Provide a summary and at least one check with name, status (passed, issue, not_checked), and detail.",
      };
}

/**
 * download_file's limits, shared by both agents: our server fetches the URL (public HTTPS only,
 * see homework/download.ts) and the caller puts the bytes into the sandbox.
 */
export function downloadBudget(input: Pick<AgentInput, "fetchUrl" | "onProgress">) {
  let count = 0;
  let bytes = 0;
  return async (
    rawInput: unknown,
  ): Promise<
    | { ok: true; file: { name: string; data: Uint8Array; contentType: string } }
    | { ok: false; error: string }
  > => {
    const parsed = z.object({ url: z.string().url() }).safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: "download_file needs a valid URL." };
    const url = parsed.data.url;
    if (!input.fetchUrl) return { ok: false, error: "Downloads aren't available in this run." };
    if (count >= MAX_DOWNLOADS)
      return { ok: false, error: `Limit of ${MAX_DOWNLOADS} downloads per run reached.` };
    count++;
    await input.onProgress?.(`Downloading ${url.slice(0, 80)}`);
    try {
      const file = await input.fetchUrl(url);
      if (bytes + file.data.byteLength > MAX_DOWNLOAD_BYTES)
        return { ok: false, error: "That would go over this run's download limit." };
      bytes += file.data.byteLength;
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "The download failed." };
    }
  };
}

/** A short, human line for a shell command (shown live on the page). */
export function describeCommand(cmd: string): string {
  if (/nbbuild\.py/.test(cmd)) return "Running the notebook";
  if (/\bpython\b/.test(cmd)) return "Running Python";
  return "Working in the sandbox";
}
