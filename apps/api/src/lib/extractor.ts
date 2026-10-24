import { ExtractResult } from "@talvra/contracts";
import type { Bindings } from "../env.js";

export class ExtractError extends Error {
  constructor(
    /** unsupported/unreadable/too_large are final; unavailable is retried. */
    readonly kind: "unsupported" | "unreadable" | "too_large" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export type Extractor = (
  data: ArrayBuffer,
  file: { filename: string; mimeType: string | null },
) => Promise<ExtractResult>;

const KINDS: Record<number, ExtractError["kind"]> = {
  413: "too_large",
  415: "unsupported",
  422: "unreadable",
};

/** Calls the extract service through any fetcher (container stub or plain fetch). */
export function httpExtractor(
  send: (req: Request) => Promise<Response>,
  url: string,
  secret?: string,
): Extractor {
  return async (data, { filename, mimeType }) => {
    const headers = new Headers({
      "content-type": mimeType ?? "application/octet-stream",
      "x-filename": encodeURIComponent(filename),
    });
    if (secret) headers.set("authorization", `Bearer ${secret}`);
    let res: Response;
    try {
      res = await send(
        new Request(url, {
          method: "POST",
          body: data,
          headers,
          signal: AbortSignal.timeout(120_000),
        }),
      );
    } catch (err) {
      console.warn(JSON.stringify({ msg: "extractor unreachable", error: String(err) }));
      throw new ExtractError("unavailable", "The file reader is busy. Trying again shortly.");
    }
    if (res.ok) {
      const parsed = ExtractResult.safeParse(await res.json().catch(() => null));
      if (!parsed.success)
        throw new ExtractError("unavailable", "The file reader returned something unexpected.");
      return parsed.data;
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const kind = KINDS[res.status] ?? "unavailable";
    throw new ExtractError(kind, body?.error?.message ?? `Extractor returned ${res.status}.`);
  };
}

/**
 * Production: the Cloudflare Container (EXTRACT). Fallback: EXTRACT_URL (Azure
 * Container Apps running the same image) with EXTRACT_SECRET.
 */
export function extractorFor(env: Bindings): Extractor | null {
  if (env.EXTRACT_URL) {
    // A network-reachable extractor must be authenticated.
    if (!env.EXTRACT_SECRET) throw new Error("EXTRACT_URL is set without EXTRACT_SECRET");
    return httpExtractor(
      (req) => fetch(req),
      `${env.EXTRACT_URL.replace(/\/$/, "")}/extract`,
      env.EXTRACT_SECRET,
    );
  }
  if (env.EXTRACT) {
    const ns = env.EXTRACT;
    // A small fixed pool of instances; each handles two requests at a time.
    return httpExtractor(
      (req) => ns.getByName(`extract-${Math.floor(Math.random() * 3)}`).fetch(req),
      "http://extract/extract",
    );
  }
  return null;
}
