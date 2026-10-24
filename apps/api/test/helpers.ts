import type { Database } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { type AppOptions, createApp } from "../src/app.js";
import type { Bindings } from "../src/env.js";
import type { Email } from "../src/lib/email.js";

export const APP_URL = "http://localhost:5173";

export const env: Bindings = {
  APP_ENV: "development",
  APP_VERSION: "test",
  APP_URL,
  ALLOWED_EMAIL_DOMAINS: "morgan.edu",
  EMAIL_FROM: "Talvra <test@talvra.app>",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  CANVAS_TOKEN_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  // Never called: tests fake the model. Present so "Talvra's key" is an available source.
  ANTHROPIC_API_KEY: "sk-ant-test",
};

/** A test harness: app + captured emails + a tiny cookie jar. */
export async function harness(
  opts: Omit<AppOptions, "db" | "sendEmail"> & { db?: Database; env?: Partial<Bindings> } = {},
) {
  const db = opts.db ?? (await createTestDb());
  const emails: Email[] = [];
  const app = createApp({ ...opts, db, sendEmail: async (e) => void emails.push(e) });
  let cookies = new Map<string, string>();

  async function request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", APP_URL);
    if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await app.request(path, { ...init, headers, body }, { ...env, ...opts.env });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      const value = rest.join("=");
      if (value === "" || /max-age=0/i.test(c)) cookies.delete(name.trim());
      else cookies.set(name.trim(), value);
    }
    return res;
  }

  return {
    app,
    db,
    emails,
    request,
    clearCookies: () => {
      cookies = new Map();
    },
    /** Path + query of the first link in the newest email. */
    lastEmailLink() {
      const email = emails.at(-1);
      const url = email?.text.match(/https?:\/\/\S+/)?.[0];
      if (!url) throw new Error("no link in last email");
      const u = new URL(url);
      return u.pathname + u.search;
    },
  };
}

/** Signs up and verifies a user; leaves the harness signed in. */
export async function signedInUser(
  h: Awaited<ReturnType<typeof harness>>,
  email = "student@morgan.edu",
  password = "correct horse battery",
) {
  const res = await h.request("/api/auth/sign-up/email", {
    method: "POST",
    json: { email, password, name: "Test Student" },
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const verify = await h.request(h.lastEmailLink());
  if (verify.status >= 400) throw new Error(`verify failed: ${verify.status}`);
  return { email, password };
}
