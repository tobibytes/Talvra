import { Container } from "@cloudflare/containers";
import type { Bindings } from "./env.js";

/**
 * The Python extract service (apps/extract) as a Cloudflare Container. It has
 * no internet access: the Worker sends it bytes and it sends back Markdown.
 */
export class ExtractContainer extends Container<Bindings> {
  override defaultPort = 8000;
  override sleepAfter = "5m";
  override enableInternet = false;
}
