import { z } from "zod";

export const AiProvider = z.enum(["anthropic", "openai"]);
export type AiProvider = z.infer<typeof AiProvider>;

const ApiKey = z.string().trim().min(20, "That doesn't look like an API key").max(400);

/** What powers a student's AI features. Keys never leave the server (only the last 4). */
export const AiSettings = z.object({
  /** "own": the student's key. "talvra": the app's key, with daily limits. */
  source: z.enum(["talvra", "own"]),
  provider: AiProvider.nullable(),
  model: z.string().nullable(),
  keyLast4: z.string().nullable(),
  status: z.enum(["active", "invalid"]).nullable(),
  /** Why the student's key stopped working; Talvra's AI is used meanwhile. */
  lastError: z.string().nullable(),
  /** Talvra's own models, for the explanation in Settings. */
  defaults: z.object({ standard: z.string(), advanced: z.string(), basic: z.string() }),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const ListAiModels = z.object({ provider: AiProvider, apiKey: ApiKey });
export type ListAiModels = z.infer<typeof ListAiModels>;

export const AiModelOption = z.object({ id: z.string(), name: z.string() });
export type AiModelOption = z.infer<typeof AiModelOption>;

export const AiModelList = z.object({
  models: z.array(AiModelOption),
  /** A sensible default from the list. */
  suggested: z.string().nullable(),
});
export type AiModelList = z.infer<typeof AiModelList>;

export const SaveAiKey = z.object({
  provider: AiProvider,
  apiKey: ApiKey,
  model: z.string().trim().min(1).max(120),
});
export type SaveAiKey = z.infer<typeof SaveAiKey>;
