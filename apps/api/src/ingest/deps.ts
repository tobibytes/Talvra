import { createDb, type Database } from "@talvra/db";
import type { Bindings } from "../env.js";
import { extractorFor } from "../lib/extractor.js";
import { publishDocumentToHub } from "../realtime/hub.js";
import { searchDepsFor } from "../routes/search.js";
import { indexDocument } from "../search/engine.js";
import type { IngestDeps } from "./process.js";

/** Production ingestion deps (queue consumer, and inline reads such as homework attachments). */
export function ingestDepsFor(env: Bindings, db?: Database): IngestDeps {
  const extract = extractorFor(env);
  if (!env.HYPERDRIVE || !env.FILES || !extract) {
    throw new Error("Ingest needs HYPERDRIVE, FILES and EXTRACT (or EXTRACT_URL)");
  }
  const conn = db ?? createDb(env.HYPERDRIVE.connectionString);
  return {
    db: conn,
    files: env.FILES,
    extract,
    tokenKey: env.CANVAS_TOKEN_KEY,
    notify: (userId, doc) => publishDocumentToHub(env, userId, doc),
    index: (doc, sections) => indexDocument({ db: conn, ...searchDepsFor(env) }, doc, sections),
  };
}
