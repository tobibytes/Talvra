import { Container } from "@cloudflare/containers";
import type { Bindings } from "./env.js";

/** The Python media service (apps/media): Pillow + ffmpeg, no internet. */
export class MediaContainer extends Container<Bindings> {
  override defaultPort = 8000;
  override sleepAfter = "3m";
  override enableInternet = false;
}
