import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  ApiKeyList,
  ApiKeyParams,
  ConnectedAppList,
  ConnectedAppParams,
  CreateApiKey,
  CreatedApiKey,
} from "@talvra/contracts";
import { and, count, desc, eq, schema } from "@talvra/db";
import type { AppEnv } from "../env.js";
import { MAX_API_KEYS, newApiKey, toApiKey } from "../lib/api-keys.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { apiKeys, oauthClients, oauthConsents, oauthRefreshTokens, oauthAccessTokens } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const unauthorized = { 401: { description: "Not signed in", content: json(ApiError) } };

const list = createRoute({
  method: "get",
  path: "/me/api-keys",
  tags: ["account"],
  summary: "Personal API keys for the MCP server (never the keys themselves)",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Keys", content: json(ApiKeyList) }, ...unauthorized },
});

const create = createRoute({
  method: "post",
  path: "/me/api-keys",
  tags: ["account"],
  summary: "Make a key. The response is the only time the full key is shown",
  middleware: [requireUser] as const,
  request: { body: { content: json(CreateApiKey), required: true } },
  responses: {
    201: { description: "Made", content: json(CreatedApiKey) },
    409: { description: "Too many keys", content: json(ApiError) },
    ...unauthorized,
  },
});

const revoke = createRoute({
  method: "delete",
  path: "/me/api-keys/{keyId}",
  tags: ["account"],
  summary: "Revoke a key (it stops working at once)",
  middleware: [requireUser] as const,
  request: { params: ApiKeyParams },
  responses: {
    204: { description: "Revoked" },
    404: { description: "No such key", content: json(ApiError) },
    ...unauthorized,
  },
});

const listApps = createRoute({
  method: "get",
  path: "/me/connected-apps",
  tags: ["account"],
  summary: "Apps connected to the MCP server over OAuth (ChatGPT, Claude, ...)",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Apps", content: json(ConnectedAppList) }, ...unauthorized },
});

const disconnectApp = createRoute({
  method: "delete",
  path: "/me/connected-apps/{clientId}",
  tags: ["account"],
  summary: "Disconnect an app: its consent and refresh tokens are deleted at once",
  middleware: [requireUser] as const,
  request: { params: ConnectedAppParams },
  responses: {
    204: { description: "Disconnected" },
    404: { description: "Not connected", content: json(ApiError) },
    ...unauthorized,
  },
});

export const apiKeyRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listApps, async (c) => {
    const userId = c.get("userId") as string;
    const rows = await c.var.db
      .select({ consent: oauthConsents, client: oauthClients })
      .from(oauthConsents)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
      .where(eq(oauthConsents.userId, userId))
      .orderBy(desc(oauthConsents.createdAt));
    return c.json(
      {
        apps: rows.map(({ consent, client }) => ({
          clientId: client.clientId,
          name: client.name?.trim() || "An app",
          uri: client.uri ?? null,
          connectedAt: (consent.createdAt ?? new Date()).toISOString(),
        })),
      },
      200,
    );
  })
  .openapi(disconnectApp, async (c) => {
    const userId = c.get("userId") as string;
    const { clientId } = c.req.valid("param");
    const gone = await c.var.db
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
      .returning({ id: oauthConsents.id });
    // Access tokens (JWTs) can't be recalled; they expire within 15 minutes.
    await c.var.db
      .delete(oauthAccessTokens)
      .where(and(eq(oauthAccessTokens.userId, userId), eq(oauthAccessTokens.clientId, clientId)));
    await c.var.db
      .delete(oauthRefreshTokens)
      .where(and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.clientId, clientId)));
    if (!gone.length) throw new AppError("not_found", "That app isn't connected.");
    return c.body(null, 204);
  })
  .openapi(list, async (c) => {
    const userId = c.get("userId") as string;
    const rows = await c.var.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json({ keys: rows.map(toApiKey) }, 200);
  })
  .openapi(create, async (c) => {
    const userId = c.get("userId") as string;
    const { name } = c.req.valid("json");
    const [{ n } = { n: 0 }] = await c.var.db
      .select({ n: count() })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));
    if (n >= MAX_API_KEYS)
      throw new AppError("conflict", `You can have ${MAX_API_KEYS} keys. Revoke one first.`);
    const key = await newApiKey();
    const [row] = await c.var.db
      .insert(apiKeys)
      .values({ userId, name, keyHash: key.hash, keyLast4: key.last4 })
      .returning();
    if (!row) throw new Error("API key insert returned nothing");
    return c.json({ key: toApiKey(row), secret: key.secret }, 201);
  })
  .openapi(revoke, async (c) => {
    const userId = c.get("userId") as string;
    const { keyId } = c.req.valid("param");
    const gone = await c.var.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id });
    if (!gone.length) throw new AppError("not_found", "That key doesn't exist.");
    return c.body(null, 204);
  });
