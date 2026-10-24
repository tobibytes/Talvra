import type { Database } from "@talvra/db";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import type { Auth } from "../auth.js";
import { type Bindings, mcpResource } from "../env.js";
import { API_KEY_PREFIX, userForApiKey } from "../lib/api-keys.js";

/**
 * Who is calling /api/mcp. Two ways in:
 * - OAuth (ChatGPT and claude.ai connectors): a JWT access token issued by our own
 *   oauth-provider for the MCP resource, verified locally against our signing keys.
 * - A personal API key (Settings), as `Authorization: Bearer tlv_…` or `X-API-Key: tlv_…` for
 *   clients that can't set the Authorization header.
 * Never the session cookie, so another site can't use a signed-in browser.
 */

const origin = (env: Pick<Bindings, "APP_URL">) => new URL(env.APP_URL).origin;

/** The issuer our tokens carry: Better Auth's base URL + path. */
export const authIssuer = (env: Pick<Bindings, "APP_URL">) => `${origin(env)}/api/auth`;

/** RFC 9728 metadata URL for the MCP resource (path-inserted form). */
export const resourceMetadataUrl = (env: Pick<Bindings, "APP_URL">) =>
  `${origin(env)}/.well-known/oauth-protected-resource/api/mcp`;

export const wwwAuthenticate = (env: Pick<Bindings, "APP_URL">) =>
  `Bearer resource_metadata="${resourceMetadataUrl(env)}"`;

/** RFC 9728 protected-resource metadata for /api/mcp. */
export function protectedResourceMetadata(env: Pick<Bindings, "APP_URL">) {
  return {
    resource: mcpResource(env),
    authorization_servers: [authIssuer(env)],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_name: "Talvra",
    resource_documentation: `${origin(env)}/settings`,
  };
}

// Signing keys change rarely; keep them per isolate for a few minutes.
let keyCache: { at: number; set: ReturnType<typeof createLocalJWKSet> } | null = null;

async function signingKeys(auth: Auth) {
  if (keyCache && Date.now() - keyCache.at < 5 * 60_000) return keyCache.set;
  const jwks = (await auth.api.getJwks()) as JSONWebKeySet;
  keyCache = { at: Date.now(), set: createLocalJWKSet(jwks) };
  return keyCache.set;
}

/** The user id in a valid access token for our MCP resource, or null. */
export async function userForAccessToken(
  auth: Auth,
  env: Pick<Bindings, "APP_URL">,
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, await signingKeys(auth), {
      issuer: authIssuer(env),
      audience: mcpResource(env),
    });
    // DPoP-bound tokens need a proof we don't check; connectors use plain bearer tokens.
    if (payload.cnf) return null;
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    keyCache = null; // a rotated key: refetch next time
    return null;
  }
}

export async function mcpUser(
  req: { header: (name: string) => string | undefined },
  db: Database,
  auth: () => Auth,
  env: Pick<Bindings, "APP_URL">,
): Promise<string | null> {
  const authz = req.header("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const apiKey = (req.header("x-api-key") ?? "").trim() || bearer;
  if (apiKey.startsWith(API_KEY_PREFIX)) return userForApiKey(db, apiKey);
  if (bearer.split(".").length === 3) return userForAccessToken(auth(), env, bearer);
  return null;
}
