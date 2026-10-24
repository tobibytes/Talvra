import { z } from "zod";
import { Id, Timestamp } from "./common.js";

/** A personal API key for the MCP server. The key itself is only ever returned once. */
export const ApiKey = z.object({
  id: Id,
  name: z.string(),
  last4: z.string(),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const ApiKeyList = z.object({ keys: z.array(ApiKey) });
export type ApiKeyList = z.infer<typeof ApiKeyList>;

export const CreateApiKey = z.object({
  name: z.string().trim().min(1, "Name the key (e.g. Claude Desktop)").max(60),
});
export type CreateApiKey = z.infer<typeof CreateApiKey>;

export const CreatedApiKey = z.object({
  key: ApiKey,
  /** The full key (tlv_…). Shown once; only its hash is stored. */
  secret: z.string(),
});
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

export const ApiKeyParams = z.object({ keyId: Id });

/** An app connected over OAuth (ChatGPT, Claude, ...). */
export const ConnectedApp = z.object({
  clientId: z.string(),
  name: z.string(),
  uri: z.string().nullable(),
  connectedAt: Timestamp,
});
export type ConnectedApp = z.infer<typeof ConnectedApp>;

export const ConnectedAppList = z.object({ apps: z.array(ConnectedApp) });
export type ConnectedAppList = z.infer<typeof ConnectedAppList>;

export const ConnectedAppParams = z.object({ clientId: z.string().min(1).max(500) });
