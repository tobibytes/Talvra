import type { AiModelOption } from "@talvra/contracts";
import { z } from "zod";
import type { Fetch } from "../lib/canvas.js";
import type { Answerer } from "./ask.js";
import { askUserTurn } from "./ask.js";
import { GenerationError, type Generator, KeyError, SCHEMAS, type Structured } from "./claude.js";
import { kindInstruction, SYSTEM_PROMPT } from "./prompts.js";

/**
 * OpenAI-style chat completions, which both OpenAI and Workers AI's open models
 * speak. A transport sends one request body; everything else is shared.
 */
export type ChatTransport = {
  model: string;
  /** OpenAI wants max_completion_tokens; Workers AI wants max_tokens. */
  tokensParam: "max_completion_tokens" | "max_tokens";
  complete(body: Record<string, unknown>): Promise<unknown>;
  stream(body: Record<string, unknown>): Promise<ReadableStream<Uint8Array>>;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const OPENAI = "https://api.openai.com/v1";

/** HTTP status → a GenerationError (own key problems become KeyError, to fall back). */
function openAiError(status: number, body: string): GenerationError {
  if (status === 401 || status === 403)
    return new KeyError("invalid", "OpenAI rejected your API key.");
  if (status === 404)
    return new KeyError("invalid", "Your chosen OpenAI model isn't available to your key.");
  if (status === 429 && /insufficient_quota|billing/i.test(body))
    return new KeyError("no_credit", "Your OpenAI account is out of credit.");
  if (status === 429 || status >= 500)
    return new GenerationError(true, "The AI is busy right now. Try again in a minute.");
  console.error(JSON.stringify({ msg: "openai error", status, body: body.slice(0, 300) }));
  return new GenerationError(false, "The AI couldn't make this from this material.");
}

export function openAiTransport(apiKey: string, model: string, fetchImpl: Fetch = fetch) {
  const call = async (body: Record<string, unknown>) => {
    let res: Response;
    try {
      res = await fetchImpl(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, ...body }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      throw new GenerationError(true, "Couldn't reach OpenAI. Try again in a minute.");
    }
    if (!res.ok) throw openAiError(res.status, await res.text().catch(() => ""));
    return res;
  };
  return {
    model,
    tokensParam: "max_completion_tokens",
    complete: async (body) => (await call(body)).json(),
    stream: async (body) => {
      const res = await call({ ...body, stream: true });
      if (!res.body) throw new GenerationError(true, "OpenAI sent an empty response.");
      return res.body;
    },
  } satisfies ChatTransport;
}

/** Workers AI (Cloudflare's hosted open models). Talvra's free "basic" fallback. */
export function workersAiTransport(ai: Ai, model: string): ChatTransport {
  const run = async (body: Record<string, unknown>) => {
    try {
      return await (ai.run as (m: string, b: unknown) => Promise<unknown>)(model, body);
    } catch (err) {
      console.error(JSON.stringify({ msg: "workers ai error", model, error: String(err) }));
      throw new GenerationError(true, "The basic AI is busy right now. Try again in a minute.");
    }
  };
  return {
    model,
    tokensParam: "max_tokens",
    complete: run,
    stream: async (body) => (await run({ ...body, stream: true })) as ReadableStream<Uint8Array>,
  };
}

/** The text of a completion: OpenAI shape, or Workers AI's legacy `{ response }`. */
function completionText(out: unknown): string | null {
  const o = out as {
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    response?: unknown;
  };
  const content = o?.choices?.[0]?.message?.content ?? o?.response;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") return JSON.stringify(content);
  return null;
}

/** JSON Schema for a zod schema, as chat-completions `response_format` wants it. */
export function jsonSchemaOf(schema: z.ZodType) {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
}

/** Text out of the first ```json block or the outermost braces, for models that wrap JSON. */
function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function compatStructured(t: ChatTransport): Structured {
  return async ({ schema, system, user, maxTokens = 8000 }) => {
    const out = await t.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ] satisfies ChatMessage[],
      [t.tokensParam]: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "output", schema: jsonSchemaOf(schema), strict: false },
      },
    });
    const text = completionText(out);
    const parsed = schema.safeParse(text ? parseJsonLoose(text) : null);
    if (!parsed.success) {
      throw new GenerationError(true, "The AI returned an unexpected format. Try again.");
    }
    const model = (out as { model?: string })?.model ?? t.model;
    return { data: parsed.data, model };
  };
}

/** Study aids through any chat-completions model: same prompts and schemas as Claude. */
export function compatGenerator(t: ChatTransport): Generator {
  const structured = compatStructured(t);
  return async ({ kind, documentXml }) => {
    const { data, model } = await structured({
      schema: SCHEMAS[kind] as z.ZodType<unknown>,
      system: SYSTEM_PROMPT,
      user: `${documentXml}\n\n${kindInstruction(kind)}`,
      maxTokens: kind === "notes" ? 24000 : 16000,
    });
    return {
      content: data,
      model,
      inputTokens: Math.ceil(documentXml.length / 4),
      outputTokens: 0,
    };
  };
}

/** Server-sent events → the text deltas (OpenAI and Workers AI shapes). */
async function* sseText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const evt = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
          response?: string;
        };
        const text = evt.choices?.[0]?.delta?.content ?? evt.response;
        if (text) yield text;
      } catch {
        // keep-alive or partial line
      }
    }
  }
}

/**
 * Some open models cite as 【1】; the app's citation links expect [1]. Converts
 * them, holding back a chunk that ends inside an unclosed 【 until it closes.
 */
export async function* normalizeCitations(chunks: AsyncIterable<string>) {
  let held = "";
  for await (const chunk of chunks) {
    const text = held + chunk;
    const open = text.lastIndexOf("【");
    const cut = open > text.lastIndexOf("】") ? open : text.length;
    held = text.slice(cut);
    const ready = text.slice(0, cut).replace(/【\s*(\d+)[^】]*】/g, "[$1]");
    if (ready) yield ready;
  }
  if (held) yield held.replace(/【\s*(\d+)[^】]*】/g, "[$1]");
}

export function compatAnswerer(t: ChatTransport, system: string): Answerer {
  return async function* ({ question, history, sources }) {
    const stream = await t.stream({
      messages: [
        { role: "system", content: system },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: askUserTurn({ question, sources }) },
      ] satisfies ChatMessage[],
      [t.tokensParam]: 4000,
    });
    yield* normalizeCitations(sseText(stream));
  };
}

/** Text models a student's OpenAI key can use, newest first, plus a sensible default. */
export async function listOpenAiModels(apiKey: string, fetchImpl: Fetch = fetch) {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GenerationError(true, "Couldn't reach OpenAI. Try again in a minute.");
  }
  if (!res.ok) throw openAiError(res.status, await res.text().catch(() => ""));
  const body = (await res.json()) as { data?: { id: string; created?: number }[] };
  const NOT_CHAT =
    /(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|computer|davinci|babbage|codex|sora)/i;
  const models = (body.data ?? [])
    .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !NOT_CHAT.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const options: AiModelOption[] = models.map((m) => ({ id: m.id, name: m.id }));
  // Newest small model is a good, cheap default; otherwise the newest model.
  const suggested =
    models.find((m) => /mini|luna/i.test(m.id) && !/\d{4}-\d{2}-\d{2}/.test(m.id))?.id ??
    models[0]?.id ??
    null;
  return { models: options, suggested };
}
