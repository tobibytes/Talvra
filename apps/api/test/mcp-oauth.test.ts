import { CreatedApiKey } from "@talvra/contracts";
import { describe, expect, it } from "vitest";
import { APP_URL, harness, signedInUser } from "./helpers.js";

const MCP = `${APP_URL}/api/mcp`;
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge };
}

type H = Awaited<ReturnType<typeof harness>>;

/** Calls without the browser's cookies, like a connector's server would. */
async function asConnector(h: H, path: string, init: RequestInit & { json?: unknown } = {}) {
  const saved = h.clearCookies();
  try {
    return await h.request(path, init);
  } finally {
    h.restoreCookies(saved);
  }
}

const rpc = (h: H, headers: Record<string, string>, method = "tools/list") =>
  asConnector(h, "/api/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", ...headers },
    json: { jsonrpc: "2.0", id: 1, method, params: {} },
  });

/** Runs the whole connector flow and returns the token response. */
async function connect(h: H) {
  // 1. Discovery, starting from the resource the way MCP clients do.
  const unauth = await rpc(h, {});
  expect(unauth.status).toBe(401);
  const challenge = unauth.headers.get("www-authenticate") ?? "";
  const metaUrl = new URL(/resource_metadata="([^"]+)"/.exec(challenge)?.[1] ?? "");
  expect(metaUrl.pathname).toBe("/.well-known/oauth-protected-resource/api/mcp");
  const resource = (await (await h.request(`/api${metaUrl.pathname}`)).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  expect(resource.resource).toBe(MCP);
  const issuer = new URL(resource.authorization_servers[0] ?? "");
  const server = (await (
    await h.request(`/api/.well-known/oauth-authorization-server${issuer.pathname}`)
  ).json()) as {
    code_challenge_methods_supported: string[];
    registration_endpoint: string;
    authorization_endpoint: string;
    token_endpoint: string;
  };
  expect(server.code_challenge_methods_supported).toContain("S256");

  // 2. Dynamic client registration (public client, PKCE).
  const reg = await asConnector(h, new URL(server.registration_endpoint).pathname, {
    method: "POST",
    json: {
      client_name: "ChatGPT",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });
  expect(reg.status).toBeLessThan(300);
  const client = (await reg.json()) as { client_id: string };
  expect(client.client_id).toBeTruthy();

  // 3. The student's browser: authorize → our consent page → approve.
  const { verifier, challenge: codeChallenge } = await pkce();
  const authorize = new URL(server.authorization_endpoint);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    scope: "openid profile email offline_access",
    state: "xyz",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: MCP,
  }).toString();
  const toConsent = await h.request(`${authorize.pathname}${authorize.search}`);
  const consentUrl = new URL(
    toConsent.headers.get("location") ?? ((await toConsent.json()) as { url: string }).url,
    APP_URL,
  );
  expect(consentUrl.pathname).toBe("/oauth/consent");
  const consent = await h.request("/api/auth/oauth2/consent", {
    method: "POST",
    json: { accept: true, oauth_query: consentUrl.search.slice(1) },
  });
  expect(consent.status).toBe(200);
  const back = new URL(((await consent.json()) as { url: string }).url);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("xyz");
  const code = back.searchParams.get("code") ?? "";

  // 4. The connector's server swaps the code (with the PKCE verifier) for tokens.
  const token = await asConnector(h, new URL(server.token_endpoint).pathname, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: MCP,
    }).toString(),
  });
  expect(token.status).toBe(200);
  const tokens = (await token.json()) as { access_token: string; refresh_token: string };
  return { tokens, client, server };
}

describe("MCP over OAuth (ChatGPT / claude.ai connectors)", () => {
  it("discovers, registers, gets consent, swaps the code and calls tools with the token", async () => {
    const h = await harness();
    await signedInUser(h);
    const { tokens } = await connect(h);
    expect(tokens.access_token.split(".")).toHaveLength(3);
    expect(tokens.refresh_token).toBeTruthy();

    const list = await rpc(h, { authorization: `Bearer ${tokens.access_token}` });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("list_courses");

    // A tampered token is refused.
    const bad = await rpc(h, { authorization: `Bearer ${tokens.access_token.slice(0, -2)}xx` });
    expect(bad.status).toBe(401);
  });

  it("refreshes tokens", async () => {
    const h = await harness();
    await signedInUser(h);
    const { tokens, client, server } = await connect(h);
    const res = await asConnector(h, new URL(server.token_endpoint).pathname, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        resource: MCP,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as { access_token: string };
    expect((await rpc(h, { authorization: `Bearer ${fresh.access_token}` })).status).toBe(200);
  });

  it("serves discovery at the site root through the front door", async () => {
    const { frontDoor } = await import("../src/front.js");
    const seen: string[] = [];
    const assets = { fetch: async () => new Response("spa") };
    const api = (req: Request) => {
      seen.push(new URL(req.url).pathname);
      return new Response("api");
    };
    for (const p of [
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration",
    ])
      expect(await (await frontDoor(api, assets, new Request(`${APP_URL}${p}`))).text()).toBe(
        "api",
      );
    expect(seen).toEqual([
      "/api/.well-known/oauth-protected-resource/api/mcp",
      "/api/.well-known/oauth-authorization-server/api/auth",
      "/api/.well-known/openid-configuration",
    ]);
    expect(
      await (await frontDoor(api, assets, new Request(`${APP_URL}/.well-known/other`))).text(),
    ).toBe("spa");
  });
});

describe("MCP with a personal API key", () => {
  it("accepts the key as X-API-Key for clients that can't set Authorization", async () => {
    const h = await harness();
    await signedInUser(h);
    const made = CreatedApiKey.parse(
      await (
        await h.request("/api/v1/me/api-keys", { method: "POST", json: { name: "Cursor" } })
      ).json(),
    );
    expect((await rpc(h, { "x-api-key": made.secret })).status).toBe(200);
    expect((await rpc(h, { "x-api-key": "tlv_wrong" })).status).toBe(401);
  });
});

describe("connected apps", () => {
  it("lists the connected app and disconnecting stops its refresh token", async () => {
    const h = await harness();
    await signedInUser(h);
    const { tokens, client, server } = await connect(h);
    const list = (await (await h.request("/api/v1/me/connected-apps")).json()) as {
      apps: unknown[];
    };
    expect(list.apps).toMatchObject([{ clientId: client.client_id, name: "ChatGPT" }]);

    const del = await h.request(
      `/api/v1/me/connected-apps/${encodeURIComponent(client.client_id)}`,
      {
        method: "DELETE",
      },
    );
    expect(del.status).toBe(204);
    const after = (await (await h.request("/api/v1/me/connected-apps")).json()) as {
      apps: unknown[];
    };
    expect(after.apps).toEqual([]);
    const refresh = await asConnector(h, new URL(server.token_endpoint).pathname, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      }).toString(),
    });
    expect(refresh.status).toBeGreaterThanOrEqual(400);
  });

  it("can't disconnect another account's app", async () => {
    const h = await harness();
    await signedInUser(h);
    const { client } = await connect(h);
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    const res = await h.request(
      `/api/v1/me/connected-apps/${encodeURIComponent(client.client_id)}`,
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(404);
  });
});
