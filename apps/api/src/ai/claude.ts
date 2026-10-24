import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { FlashcardSet, Quiz, type StudyAidKind, StudyNotes } from "@talvra/contracts";
import type { z } from "zod";
import { kindInstruction, SYSTEM_PROMPT } from "./prompts.js";

export const MODEL = "claude-opus-5-5";

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

export type GenerateInput = { kind: StudyAidKind; documentXml: string };
export type GenerateOutput = {
  content: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** Calls the model. Tests swap this for a fake. */
export type Generator = (input: GenerateInput) => Promise<GenerateOutput>;

/**
 * Claude Opus 5.5 with structured output, streamed (outputs can be long) and
 * prompt-cached (system + document are a shared prefix across the three
 * kinds). Server-side refusal fallback is on.
 */
export function claudeGenerator(apiKey: string): Generator {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return async ({ kind, documentXml }) => {
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS[kind],
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: zodOutputFormat(SCHEMAS[kind]) },
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
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      ) {
        // Operator problem (bad/missing key), not the student's: log it, say little.
        console.error(JSON.stringify({ msg: "anthropic auth failed", status: err.status }));
        throw new GenerationError(false, "Study tools are temporarily unavailable.");
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new GenerationError(false, `The request was rejected: ${err.message}`);
      }
      if (
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError
      ) {
        throw new GenerationError(true, `Claude is busy right now (${err.message}).`);
      }
      if (err instanceof Anthropic.APIError) {
        throw new GenerationError(err.status !== undefined && err.status >= 500, err.message);
      }
      throw err;
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
