import { readCapped } from "../lib/canvas.js";

/** Fetch public assignment resources without forwarding account cookies or Canvas tokens. */
export async function downloadHomeworkFile(raw: string, fetchImpl: typeof fetch = fetch) {
  let url = new URL(raw);
  const signal = AbortSignal.timeout(60_000);
  const maxBytes = 20 * 1024 * 1024;
  for (let hop = 0; hop < 6; hop++) {
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !host.includes(".") ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.includes(":") ||
      /^[\d.]+$/.test(host)
    )
      throw new Error("Use a public HTTPS file URL.");
    const res = await fetchImpl(url.toString(), { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (!location) throw new Error("Download redirected without a location.");
      url = new URL(location, url);
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`Download returned ${res.status}. Use a direct file URL.`);
    }
    if (Number(res.headers.get("content-length")) > maxBytes) {
      await res.body.cancel();
      throw new Error("This file exceeds the 20 MB download limit.");
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const rawName =
      disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ??
      disposition.match(/filename="([^"]+)"/i)?.[1] ??
      url.pathname.split("/").pop() ??
      "download";
    let decoded = rawName;
    try {
      decoded = decodeURIComponent(rawName);
    } catch {
      /* Keep malformed names readable. */
    }
    const name =
      decoded
        .split(/[\\/]/)
        .pop()
        ?.replace(/[^\w.\- ]/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 100) || "download";
    return {
      name,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: new Uint8Array(await readCapped(res.body, maxBytes)),
    };
  }
  throw new Error("Too many download redirects.");
}
