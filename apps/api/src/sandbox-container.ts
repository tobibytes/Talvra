import { Container } from "@cloudflare/containers";
import type { Bindings } from "./env.js";

/**
 * The homework sandbox (apps/sandbox, docs/v2/SANDBOX.md): one instance per agent run, addressed
 * by a fresh id and destroyed when the run ends, so runs never share a machine. Unlike the other
 * containers it has the internet (packages, APIs, a real browser). It holds no secrets: model
 * keys and Canvas stay in the Worker.
 */
export class SandboxContainer extends Container<Bindings> {
  override defaultPort = 8000;
  // A run is capped at 12 minutes; this only reaps an instance whose Worker died mid-run.
  override sleepAfter = "15m";
  override enableInternet = true;
  // Nothing in here should talk to us or to cloud metadata endpoints.
  override deniedHosts = [
    "hwrk.help",
    "www.hwrk.help",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata",
  ];
  // Reachable only through this Durable Object, so no shared secret.
  override envVars = { ALLOW_NO_AUTH: "1" };
}
