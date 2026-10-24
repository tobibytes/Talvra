import { describe, expect, it, vi } from "vitest";
import { wantsOwnSandbox } from "../src/homework/agent-deps.js";
import { httpSandbox, sandboxFor } from "../src/homework/sandbox-client.js";

describe("which sandbox Do my homework uses", () => {
  it("defaults to Anthropic's; HOMEWORK_SANDBOX=self or a rollout email switches", () => {
    expect(wantsOwnSandbox({}, "a@morgan.edu")).toBe(false);
    expect(wantsOwnSandbox({ HOMEWORK_SANDBOX: "anthropic" }, "a@morgan.edu")).toBe(false);
    expect(wantsOwnSandbox({ HOMEWORK_SANDBOX: "self" }, undefined)).toBe(true);
    const env = { HOMEWORK_SANDBOX_EMAILS: "Owner@Morgan.edu, b@morgan.edu" };
    expect(wantsOwnSandbox(env, "owner@morgan.edu")).toBe(true);
    expect(wantsOwnSandbox(env, "someone@morgan.edu")).toBe(false);
  });

  it("only uses a sandbox URL with a secret unless it's on this machine", () => {
    expect(sandboxFor({} as never)).toBeNull();
    expect(sandboxFor({ SANDBOX_URL: "http://localhost:8001" } as never)).toBeTypeOf("function");
    expect(() => sandboxFor({ SANDBOX_URL: "https://box.example.com" } as never)).toThrow(
      "without SANDBOX_SECRET",
    );
  });
});

describe("sandbox client", () => {
  it("talks to the control server and destroys the instance on close", async () => {
    const seen: { method: string; url: string; auth: string | null; body?: string }[] = [];
    const destroy = vi.fn(async () => {});
    const send = async (req: Request) => {
      seen.push({
        method: req.method,
        url: req.url,
        auth: req.headers.get("authorization"),
        body: req.method === "GET" ? undefined : await req.text(),
      });
      const path = new URL(req.url).pathname;
      if (path === "/exec")
        return Response.json({ stdout: "hi\n", stderr: "", exit_code: 0, timed_out: false });
      if (path === "/outputs") return Response.json({ files: [{ name: "a.md", size: 1 }] });
      if (req.method === "GET") return new Response(new Uint8Array([1, 2]));
      if (path.includes("missing"))
        return Response.json({ error: { message: "Use a relative path." } }, { status: 400 });
      return Response.json({ path: "x", size: 1 });
    };
    const box = httpSandbox(send, "http://sandbox", { secret: "s", destroy });
    await box.writeFile("input/hw 1.pdf", new Uint8Array([7]));
    expect(await box.exec("echo hi", { timeoutMs: 1000 })).toEqual({
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    expect(await box.listOutputs()).toEqual(["a.md"]);
    expect(await box.readFile("output/a.md")).toEqual(new Uint8Array([1, 2]));
    await expect(box.writeFile("input/../../etc/x", new Uint8Array())).rejects.toThrow(
      "Not a workspace path",
    );
    await expect(box.writeFile("missing/x", new Uint8Array())).rejects.toThrow(
      "Use a relative path.",
    );
    await box.close();
    expect(seen[0]).toMatchObject({
      method: "PUT",
      url: "http://sandbox/files/input/hw%201.pdf",
      auth: "Bearer s",
    });
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ command: "echo hi", timeout_ms: 1000 });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
