import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { FlashcardSet, Quiz, type StudyAidKind, StudyNotes } from "@talvra/contracts";
import type { z } from "zod";
import { kindInstruction, SYSTEM_PROMPT } from "./prompts.js";

/** Talvra's models: Opus for long, high-value work; Haiku for the rest. */
export const OPUS = "claude-opus-5-5";
export const HAIKU = "claude-haiku-4-5";
export const MODEL = OPUS;

/** Which model to call, and how. `ownKey`: the student's key (errors are theirs to fix). */
export type ClaudeOptions = { model?: string; supportsEffort?: boolean; ownKey?: boolean };

/** Request params a model accepts: Haiku 4.5 takes neither `effort` nor the refusal fallback. */
export function claudeParams(o: ClaudeOptions, effort: "low" | "medium" | "high") {
  const model = o.model ?? OPUS;
  const supportsEffort = o.supportsEffort ?? model === OPUS;
  // The server-side refusal fallback is for the Claude 5 family.
  const fallback = /^claude-(opus|sonnet|fable)-5/.test(model);
  return {
    model,
    ...(fallback
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
    effort: supportsEffort ? { effort } : {},
  };
}

export const SCHEMAS = { notes: StudyNotes, flashcards: FlashcardSet, quiz: Quiz } as const;
export type AidContent<K extends StudyAidKind> = z.infer<(typeof SCHEMAS)[K]>;

const MAX_TOKENS: Record<StudyAidKind, number> = { notes: 24000, flashcards: 16000, quiz: 16000 };

export class GenerationError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** The student's own key can't be used (rejected, no credit, model gone): fall back to Talvra's. */
export class KeyError extends GenerationError {
  constructor(
    readonly problem: "invalid" | "no_credit",
    message: string,
  ) {
    super(false, message);
  }
}

export type GenerateInput = { kind: StudyAidKind; documentXml: string };
export type GenerateOutput = {
  content: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** Maps SDK errors to retryable / final GenerationErrors with student-safe messages. */
export function toGenerationError(err: unknown, ownKey = false): unknown {
  if (ownKey) {
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    )
      return new KeyError("invalid", "Anthropic rejected your API key.");
    if (err instanceof Anthropic.NotFoundError)
      return new KeyError("invalid", "Your chosen Claude model isn't available to your key.");
    if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message))
      return new KeyError("no_credit", "Your Anthropic account is out of credit.");
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    // Operator problem (bad/missing key), not the student's: log it, say little.
    console.error(JSON.stringify({ msg: "anthropic auth failed", status: err.status }));
    return new GenerationError(false, "Study tools are temporarily unavailable.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error(JSON.stringify({ msg: "anthropic bad request", error: err.message }));
    return new GenerationError(false, "Couldn't make this from this material.");
  }
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    return new GenerationError(true, "Claude is busy right now. Try again in a minute.");
  }
  if (err instanceof Anthropic.APIError) {
    console.error(
      JSON.stringify({ msg: "anthropic error", status: err.status, error: err.message }),
    );
    return new GenerationError(
      err.status !== undefined && err.status >= 500,
      "Claude couldn't finish this. Try again later.",
    );
  }
  return err;
}

/** A structured (JSON-schema) call. Tests swap this for a fake. */
export type Structured = <T>(req: {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}) => Promise<{ data: T; model: string }>;

export function claudeStructured(apiKey: string, opts: ClaudeOptions = {}): Structured {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return async ({ schema, system, user, maxTokens = 8000, effort = "low" }) => {
    const p = claudeParams(opts, effort);
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages
        .stream({
          model: p.model,
          max_tokens: maxTokens,
          ...(p.betas ? { betas: p.betas, fallbacks: p.fallbacks } : {}),
          output_config: { ...p.effort, format: zodOutputFormat(schema) },
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
        })
        .finalMessage();
    } catch (err) {
      throw toGenerationError(err, opts.ownKey);
    }
    if (message.stop_reason === "refusal") {
      throw new GenerationError(false, "Claude declined to help with this one.");
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new GenerationError(true, "Claude returned an unexpected format.");
    return { data: parsed.data, model: message.model };
  };
}

/** Calls the model. Tests swap this for a fake. */
export type Generator = (input: GenerateInput) => Promise<GenerateOutput>;

/**
 * Claude Opus 5.5 with structured output, streamed (outputs can be long) and
 * prompt-cached (system + document are a shared prefix across the three
 * kinds). Server-side refusal fallback is on.
 */
export function claudeGenerator(apiKey: string, opts: ClaudeOptions = {}): Generator {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return async ({ kind, documentXml }) => {
    const p = claudeParams(opts, "medium");
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream({
        model: p.model,
        max_tokens: MAX_TOKENS[kind],
        ...(p.betas ? { betas: p.betas, fallbacks: p.fallbacks } : {}),
        output_config: { ...p.effort, format: zodOutputFormat(SCHEMAS[kind]) },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: documentXml, cache_control: { type: "ephemeral" } },
              { type: "text", text: kindInstruction(kind) },
            ],
          },
        ],
      });
      message = await stream.finalMessage();
    } catch (err) {
      throw toGenerationError(err, opts.ownKey);
    }
    if (message.stop_reason === "refusal") {
      throw new GenerationError(false, "Claude declined to make this from this material.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new GenerationError(false, "The material is too long to make this in one go.");
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      throw new GenerationError(true, "Claude returned something that wasn't valid JSON.");
    }
    return {
      content,
      model: message.model,
      inputTokens:
        message.usage.input_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
    };
  };
}

export type ClaudeModelInfo = { id: string; name: string; supportsEffort: boolean };

/**
 * Claude models a student's key can use for Talvra (structured output required),
 * newest first, plus a default: Opus 5.5 when available. Validates the key.
 */
export async function listClaudeModels(apiKey: string) {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const models: ClaudeModelInfo[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 })) {
      if (m.capabilities && !m.capabilities.structured_outputs.supported) continue;
      models.push({
        id: m.id,
        name: m.display_name,
        supportsEffort: m.capabilities?.effort.supported ?? false,
      });
    }
  } catch (err) {
    throw toGenerationError(err, true);
  }
  const suggested = models.find((m) => m.id === OPUS)?.id ?? models[0]?.id ?? null;
  return { models, suggested };
}
