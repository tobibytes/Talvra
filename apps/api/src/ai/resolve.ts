import type { AiProvider } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, gt, notLike, schema, sql } from "@talvra/db";
import type { Bindings } from "../env.js";
import type { Fetch } from "../lib/canvas.js";
import { decryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { DAY, tryMeter, usedToday } from "../lib/usage.js";
import { type Answerer, ASK_SYSTEM, claudeAnswerer } from "./ask.js";
import {
  claudeGenerator,
  claudeStructured,
  GenerationError,
  type Generator,
  HAIKU,
  KeyError,
  OPUS,
  type Structured,
} from "./claude.js";
import {
  compatAnswerer,
  compatGenerator,
  compatStructured,
  openAiTransport,
  workersAiTransport,
} from "./compat.js";

const { aiSettings, studyAids } = schema;

export type AiTask = "notes" | "flashcards" | "quiz" | "brief" | "plan" | "ask" | "video_script";

/** Opus for the long, high-value work; Haiku for everything else. */
const ADVANCED = new Set<AiTask>(["notes", "ask"]);

/** Cloudflare-hosted open model for the free fallback (override with BASIC_MODEL). */
export const BASIC_MODEL = "@cf/openai/gpt-oss-120b";

/**
 * Daily uses of Talvra's key per student (rolling 24h). When they run out, the
 * same number again runs on the basic model; then the student waits a day.
 */
export const LIMITS: Record<AiTask, { kind: string; limit: number; message: string }> = {
  notes: { kind: "aid", limit: 40, message: "You've made a lot of study material today." },
  flashcards: { kind: "aid", limit: 40, message: "You've made a lot of study material today." },
  quiz: { kind: "aid", limit: 40, message: "You've made a lot of study material today." },
  brief: { kind: "brief", limit: 30, message: "That's a lot of assignment breakdowns today." },
  plan: { kind: "plan_suggest", limit: 30, message: "That's a lot of plan suggestions today." },
  ask: { kind: "ask", limit: 150, message: "You've asked a lot today." },
  video_script: { kind: "video_script", limit: 10, message: "That's a lot of videos today." },
};

/** Study-aid input tokens per student per day on Talvra's key (cost guard). */
export const DAILY_INPUT_TOKENS = 3_000_000;

export type AiEnv = {
  anthropicKey?: string;
  ai?: Ai;
  basicModel?: string;
  tokenKey: string;
  fetch?: Fetch;
};

export type AiSource = "own" | "talvra" | "basic";

export type PickedAi = {
  source: AiSource;
  model: string;
  structured: Structured;
  generator: Generator;
  answerer: Answerer;
};

/** Tests replace how a source turns into model calls. */
export type ImplFactory = (ref: ModelRef) => Omit<PickedAi, "source" | "model">;

export type ModelRef =
  | {
      provider: "anthropic";
      apiKey: string;
      model: string;
      supportsEffort?: boolean;
      ownKey: boolean;
    }
  | { provider: "openai"; apiKey: string; model: string; fetch?: Fetch }
  | { provider: "workers-ai"; ai: Ai; model: string };

export const realImpls: ImplFactory = (ref) => {
  if (ref.provider === "anthropic") {
    const opts = { model: ref.model, supportsEffort: ref.supportsEffort, ownKey: ref.ownKey };
    return {
      structured: claudeStructured(ref.apiKey, opts),
      generator: claudeGenerator(ref.apiKey, opts),
      answerer: claudeAnswerer(ref.apiKey, opts),
    };
  }
  const t =
    ref.provider === "openai"
      ? openAiTransport(ref.apiKey, ref.model, ref.fetch)
      : workersAiTransport(ref.ai, ref.model);
  return {
    structured: compatStructured(t),
    generator: compatGenerator(t),
    answerer: compatAnswerer(t, ASK_SYSTEM),
  };
};

export type OwnKey = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  supportsEffort: boolean;
};

/** The student's own key, decrypted, if they have a working one. */
export async function loadOwnKey(
  db: Database,
  userId: string,
  tokenKey: string,
): Promise<OwnKey | null> {
  const [row] = await db
    .select()
    .from(aiSettings)
    .where(and(eq(aiSettings.userId, userId), eq(aiSettings.status, "active")))
    .limit(1);
  if (!row) return null;
  try {
    const apiKey = await decryptSecret(
      tokenKey,
      { ciphertext: row.keyCiphertext, iv: row.keyIv },
      userId,
    );
    return { provider: row.provider, model: row.model, apiKey, supportsEffort: row.supportsEffort };
  } catch {
    return null;
  }
}

async function markKeyBroken(db: Database, userId: string, err: KeyError) {
  await db
    .update(aiSettings)
    .set({ status: "invalid", lastError: err.message })
    .where(eq(aiSettings.userId, userId));
  console.warn(JSON.stringify({ msg: "own ai key failed", problem: err.problem }));
}

/** Talvra's study-aid input tokens today (basic-mode aids don't count). */
async function talvraTokensToday(db: Database, userId: string) {
  const [{ tokens } = { tokens: 0 }] = await db
    .select({ tokens: sql<number>`coalesce(sum(${studyAids.inputTokens}), 0)::int` })
    .from(studyAids)
    .where(
      and(
        eq(studyAids.userId, userId),
        gt(studyAids.createdAt, new Date(Date.now() - DAY)),
        notLike(sql`coalesce(${studyAids.model}, '')`, "@cf/%"),
      ),
    );
  return tokens;
}

export type PickDeps = { db: Database; env: AiEnv; impls?: ImplFactory };

/** Talvra's key while the student is within today's limits, then the basic model. */
async function talvraOrBasic(deps: PickDeps, userId: string, task: AiTask): Promise<PickedAi> {
  const { db, env } = deps;
  const impls = deps.impls ?? realImpls;
  const limit = LIMITS[task];
  const aidTask = task === "notes" || task === "flashcards" || task === "quiz";
  if (
    env.anthropicKey &&
    (!aidTask || (await talvraTokensToday(db, userId)) < DAILY_INPUT_TOKENS) &&
    (await tryMeter(db, userId, limit.kind, { limit: limit.limit }))
  ) {
    const model = ADVANCED.has(task) ? OPUS : HAIKU;
    return {
      source: "talvra",
      model,
      ...impls({ provider: "anthropic", apiKey: env.anthropicKey, model, ownKey: false }),
    };
  }
  if (env.ai && (await tryMeter(db, userId, `basic_${limit.kind}`, { limit: limit.limit }))) {
    const model = env.basicModel || BASIC_MODEL;
    return {
      source: "basic",
      model,
      ...impls({ provider: "workers-ai", ai: env.ai, model }),
    };
  }
  if (!env.anthropicKey && !env.ai)
    throw new AppError("internal", "Study tools are temporarily unavailable.");
  throw new AppError(
    "rate_limited",
    `${limit.message} Try again tomorrow, or add your own AI key in Settings.`,
  );
}

/** Wraps the student's own key so a dead key falls back to Talvra's AI (and is flagged). */
function withFallback(
  own: PickedAi,
  fallback: () => Promise<PickedAi>,
  onKeyError: (e: KeyError) => Promise<void>,
): PickedAi {
  let fb: Promise<PickedAi> | null = null;
  const recover = async (err: unknown) => {
    if (!(err instanceof KeyError)) throw err;
    await onKeyError(err);
    fb ??= fallback();
    return fb;
  };
  return {
    ...own,
    structured: async (req) => {
      try {
        return await own.structured(req);
      } catch (err) {
        return (await recover(err)).structured(req);
      }
    },
    generator: async (input) => {
      try {
        return await own.generator(input);
      } catch (err) {
        return (await recover(err)).generator(input);
      }
    },
    answerer: async function* (input) {
      let started = false;
      try {
        for await (const t of own.answerer(input)) {
          started = true;
          yield t;
        }
      } catch (err) {
        if (started) throw err;
        yield* (await recover(err)).answerer(input);
      }
    },
  };
}

/**
 * Which AI runs this task for this student: their own key when they have a
 * working one (no daily limits), else Talvra's Claude within daily limits,
 * else the free basic model. Counts the use against the chosen limit.
 */
export async function pickAi(deps: PickDeps, userId: string, task: AiTask): Promise<PickedAi> {
  const own = await loadOwnKey(deps.db, userId, deps.env.tokenKey);
  if (!own) return talvraOrBasic(deps, userId, task);
  const impls = deps.impls ?? realImpls;
  const ref: ModelRef =
    own.provider === "anthropic"
      ? {
          provider: "anthropic",
          apiKey: own.apiKey,
          model: own.model,
          supportsEffort: own.supportsEffort,
          ownKey: true,
        }
      : { provider: "openai", apiKey: own.apiKey, model: own.model, fetch: deps.env.fetch };
  return withFallback(
    { source: "own", model: own.model, ...impls(ref) },
    () => talvraOrBasic(deps, userId, task),
    (e) => markKeyBroken(deps.db, userId, e),
  );
}

/** Whether the student could run this task now, without using up an allowance. */
export async function hasOwnKey(db: Database, userId: string) {
  const [row] = await db
    .select({ id: aiSettings.id })
    .from(aiSettings)
    .where(and(eq(aiSettings.userId, userId), eq(aiSettings.status, "active")))
    .limit(1);
  return Boolean(row);
}

/** The AI settings a Worker request or queue job runs with. */
export function aiEnvOf(env: Bindings): AiEnv {
  return {
    anthropicKey: env.ANTHROPIC_API_KEY,
    ai: env.AI,
    basicModel: env.BASIC_MODEL,
    tokenKey: env.CANVAS_TOKEN_KEY,
  };
}

/**
 * Refuses up front when a background task couldn't run at all today (no own key,
 * Talvra's and the basic allowance both used up). Doesn't use anything up.
 */
export async function assertCanUse(deps: PickDeps, userId: string, task: AiTask) {
  if (await hasOwnKey(deps.db, userId)) return;
  const limit = LIMITS[task];
  if (deps.env.anthropicKey && (await usedToday(deps.db, userId, limit.kind)) < limit.limit) return;
  if (deps.env.ai && (await usedToday(deps.db, userId, `basic_${limit.kind}`)) < limit.limit)
    return;
  if (!deps.env.anthropicKey && !deps.env.ai)
    throw new AppError("internal", "Study tools are temporarily unavailable.");
  throw new AppError(
    "rate_limited",
    `${limit.message} Try again tomorrow, or add your own AI key in Settings.`,
  );
}

/** Test helper shape: every source runs the same fakes. */
export function fakeImpls(f: Partial<Omit<PickedAi, "source" | "model">>): ImplFactory {
  const missing = async () => {
    throw new GenerationError(false, "not faked");
  };
  return () => ({
    structured: f.structured ?? (missing as never),
    generator: f.generator ?? (missing as never),
    answerer:
      f.answerer ??
      async function* () {
        yield* [];
        await missing();
      },
  });
}
