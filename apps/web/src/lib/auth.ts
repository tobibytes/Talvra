import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { queryOptions } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { api } from "./api";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  // Resolve fetch at call time (not import time) so tests can stub it.
  fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
  // During an MCP connector's OAuth sign-in, attaches the signed authorize query to sign-in and
  // consent requests so the flow can continue.
  plugins: [oauthProviderClient()],
});

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
export const configQuery = queryOptions({
  queryKey: ["config"],
  queryFn: api.config,
  staleTime: Infinity,
});

/**
 * Better Auth's client returns `{ error }` instead of throwing. Our own API
 * errors (e.g. the school-email check) come back in the { error: { message } }
 * envelope, so look in both places.
 */
export function authErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  if (!error || typeof error !== "object") return fallback;
  const e = error as { message?: unknown; error?: { message?: unknown }; status?: number };
  if (typeof e.message === "string" && e.message) return e.message;
  if (typeof e.error?.message === "string") return e.error.message;
  if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
  return fallback;
}

/** Only allow same-app paths as post-login redirects (no open redirects). */
export function safeRedirect(target: unknown, fallback = "/") {
  return typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
    ? target
    : fallback;
}
