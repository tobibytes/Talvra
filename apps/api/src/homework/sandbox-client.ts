import type { ExecResult, Sandbox } from "../ai/tool-loop-agent.js";
import type { Bindings } from "../env.js";

/**
 * The Worker side of our homework sandbox: a `Sandbox` over the apps/sandbox control server.
 * Production: one SandboxContainer per run, destroyed on close. Dev: SANDBOX_URL (one shared
 * container started by hand); its files persist between runs, so restart it between tries.
 */

type Send = (req: Request) => Promise<Response>;

export class SandboxError extends Error {}

/** URLs collapse "." and "..", so refuse them here rather than let them slip past the server. */
function encodePath(path: string): string {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".."))
    throw new SandboxError(`Not a workspace path: ${path}`);
  return parts.map(encodeURIComponent).join("/");
}

async function failure(res: Response, what: string): Promise<SandboxError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new SandboxError(body?.error?.message ?? `${what} failed (${res.status}).`);
}

export function httpSandbox(
  send: Send,
  base: string,
  opts: { secret?: string; destroy?: () => Promise<void> } = {},
): Sandbox {
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (opts.secret) headers.set("authorization", `Bearer ${opts.secret}`);
    return send(new Request(`${base}${path}`, { ...init, headers }));
  };
  return {
    async writeFile(path, data) {
      const res = await call(`/files/${encodePath(path)}`, { method: "PUT", body: data });
      if (!res.ok) throw await failure(res, `Saving ${path}`);
    },
    async readFile(path) {
      const res = await call(`/files/${encodePath(path)}`);
      if (!res.ok) throw await failure(res, `Reading ${path}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async exec(command, { timeoutMs }): Promise<ExecResult> {
      const res = await call("/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, timeout_ms: timeoutMs }),
        // The server enforces the timeout; this only guards against a hung connection.
        signal: AbortSignal.timeout(timeoutMs + 30_000),
      });
      if (!res.ok) throw await failure(res, "The command");
      const r = (await res.json()) as {
        stdout: string;
        stderr: string;
        exit_code: number;
        timed_out: boolean;
      };
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exit_code, timedOut: r.timed_out };
    },
    async listOutputs() {
      const res = await call("/outputs");
      if (!res.ok) throw await failure(res, "Listing files");
      return ((await res.json()) as { files: { name: string }[] }).files.map((f) => f.name);
    },
    async close() {
      await opts.destroy?.();
    },
  };
}

/** A fresh sandbox for one run, or null when none is configured here. */
export function sandboxFor(env: Bindings): (() => Promise<Sandbox>) | null {
  if (env.SANDBOX_URL) {
    const base = env.SANDBOX_URL.replace(/\/$/, "");
    // A network-reachable sandbox must be authenticated, except on this machine.
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
    if (!local && !env.SANDBOX_SECRET) throw new Error("SANDBOX_URL is set without SANDBOX_SECRET");
    return async () => httpSandbox((r) => fetch(r), base, { secret: env.SANDBOX_SECRET });
  }
  const ns = env.SANDBOX;
  if (!ns) return null;
  return async () => {
    const stub = ns.getByName(`run-${crypto.randomUUID()}`);
    return httpSandbox((r) => stub.fetch(r), "http://sandbox", {
      destroy: () => stub.destroy(),
    });
  };
}
