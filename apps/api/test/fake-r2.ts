import type { FileStore } from "../src/ingest/process.js";

/** In-memory stand-in for the R2 bucket (just the calls we use). */
export function fakeR2() {
  const objects = new Map<string, { data: Uint8Array; contentType?: string }>();
  const toBytes = (v: unknown) =>
    typeof v === "string"
      ? new TextEncoder().encode(v)
      : v instanceof ArrayBuffer
        ? new Uint8Array(v.slice(0))
        : new Uint8Array(v as Uint8Array);
  const store = {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { data: toBytes(value), contentType: opts?.httpMetadata?.contentType });
      return null;
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const o = objects.get(key);
      if (!o) return null;
      const r = opts?.range;
      const bytes = r ? o.data.slice(r.offset, r.offset + r.length) : o.data.slice();
      const copy = () => bytes.slice().buffer;
      return {
        body: new Response(bytes).body,
        httpMetadata: { contentType: o.contentType },
        arrayBuffer: async () => copy(),
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  return { store: store as unknown as FileStore, objects };
}
