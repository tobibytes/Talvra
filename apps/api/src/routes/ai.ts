import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  AiModelList,
  type AiProvider,
  AiSettings,
  ApiError,
  ListAiModels,
  SaveAiKey,
} from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { GenerationError, KeyError, listClaudeModels } from "../ai/claude.js";
import { listOpenAiModels } from "../ai/compat.js";
import { BASIC_MODEL } from "../ai/resolve.js";
import type { AppEnv, Bindings } from "../env.js";
import { encryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { aiSettings } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const errors = {
  401: { description: "Not signed in", content: json(ApiError) },
  422: { description: "Key or model not usable", content: json(ApiError) },
};

export type ModelListing = {
  models: { id: string; name: string; supportsEffort?: boolean }[];
  suggested: string | null;
};

export type AiRoutesOptions = {
  /** Tests stub the providers' model listings (which also validate the key). */
  listModels?: (provider: AiProvider, apiKey: string) => Promise<ModelListing>;
};

const realList = (provider: AiProvider, apiKey: string): Promise<ModelListing> =>
  provider === "anthropic" ? listClaudeModels(apiKey) : listOpenAiModels(apiKey);

/** Provider errors → messages for the form. */
async function checkKey(list: AiRoutesOptions["listModels"], provider: AiProvider, key: string) {
  try {
    const out = await (list ?? realList)(provider, key);
    if (!out.models.length)
      throw new AppError("validation_failed", "This key has no models Talvra can use.", [
        { path: "apiKey", message: "No usable models" },
      ]);
    return out;
  } catch (err) {
    if (err instanceof KeyError)
      throw new AppError("validation_failed", err.message, [
        { path: "apiKey", message: err.message },
      ]);
    if (err instanceof GenerationError) throw new AppError("bad_request", err.message);
    throw err;
  }
}

const defaults = (env: Bindings) => ({
  standard: "Claude Haiku 4.5",
  advanced: "Claude Opus 5.5",
  basic: env.BASIC_MODEL || BASIC_MODEL,
});

function view(env: Bindings, row: typeof aiSettings.$inferSelect | undefined): AiSettings {
  return {
    source: row ? "own" : "talvra",
    provider: row?.provider ?? null,
    model: row?.model ?? null,
    keyLast4: row?.keyLast4 ?? null,
    status: row?.status ?? null,
    lastError: row?.lastError ?? null,
    defaults: defaults(env),
  };
}

const get = createRoute({
  method: "get",
  path: "/me/ai",
  tags: ["ai"],
  summary: "Which AI powers this student's study tools",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Settings", content: json(AiSettings) }, ...errors },
});

const models = createRoute({
  method: "post",
  path: "/me/ai/models",
  tags: ["ai"],
  summary: "Check an API key and list the models it can use",
  middleware: [requireUser] as const,
  request: { body: { content: json(ListAiModels), required: true } },
  responses: { 200: { description: "Models", content: json(AiModelList) }, ...errors },
});

const save = createRoute({
  method: "put",
  path: "/me/ai",
  tags: ["ai"],
  summary: "Use the student's own API key (checked, then stored encrypted)",
  middleware: [requireUser] as const,
  request: { body: { content: json(SaveAiKey), required: true } },
  responses: { 200: { description: "Saved", content: json(AiSettings) }, ...errors },
});

const remove = createRoute({
  method: "delete",
  path: "/me/ai",
  tags: ["ai"],
  summary: "Forget the student's key and go back to Talvra's AI",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Removed", content: json(AiSettings) }, ...errors },
});

export function aiRoutes(opts: AiRoutesOptions = {}) {
  return new OpenAPIHono<AppEnv>()
    .openapi(get, async (c) => {
      const [row] = await c.var.db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.userId, c.get("userId") as string))
        .limit(1);
      return c.json(view(c.env, row), 200);
    })
    .openapi(models, async (c) => {
      const { provider, apiKey } = c.req.valid("json");
      const out = await checkKey(opts.listModels, provider, apiKey);
      return c.json(
        { models: out.models.map(({ id, name }) => ({ id, name })), suggested: out.suggested },
        200,
      );
    })
    .openapi(save, async (c) => {
      const userId = c.get("userId") as string;
      const { provider, apiKey, model } = c.req.valid("json");
      const out = await checkKey(opts.listModels, provider, apiKey);
      const chosen = out.models.find((m) => m.id === model);
      if (!chosen)
        throw new AppError("validation_failed", "That model isn't available to this key.", [
          { path: "model", message: "Pick a model from the list" },
        ]);
      const { ciphertext, iv } = await encryptSecret(c.env.CANVAS_TOKEN_KEY, apiKey, userId);
      const values = {
        provider,
        model,
        keyCiphertext: ciphertext,
        keyIv: iv,
        keyLast4: apiKey.slice(-4),
        supportsEffort: chosen.supportsEffort ?? false,
        status: "active" as const,
        lastError: null,
      };
      const [row] = await c.var.db
        .insert(aiSettings)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: aiSettings.userId, set: values })
        .returning();
      return c.json(view(c.env, row), 200);
    })
    .openapi(remove, async (c) => {
      await c.var.db.delete(aiSettings).where(eq(aiSettings.userId, c.get("userId") as string));
      return c.json(view(c.env, undefined), 200);
    });
}
