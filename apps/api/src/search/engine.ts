import type { DocSection } from "@talvra/contracts";
import { HIGHLIGHT_END, HIGHLIGHT_START, type SearchHit, type TitleMatch } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, ilike, inArray, or, schema, sql } from "@talvra/db";
import { type ChunkDraft, chunkSections, embedText } from "./chunk.js";

const { chunks, documents, courses, assignments } = schema;

/** Embeds texts (Workers AI bge-m3 in production). */
export type Embedder = (texts: string[]) => Promise<number[][]>;
/** The subset of Vectorize we use. */
export type VectorStore = Pick<Vectorize, "query" | "upsert" | "deleteByIds">;

export type SearchDeps = { db: Database; embed?: Embedder; vectors?: VectorStore };

export function workersAiEmbedder(ai: Ai): Embedder {
  return async (texts) => {
    const out = (await ai.run("@cf/baai/bge-m3", { text: texts })) as { data?: number[][] };
    if (!out.data || out.data.length !== texts.length) throw new Error("Embedding failed");
    return out.data;
  };
}

/**
 * Replaces a document's chunks (and vectors). Embedding is best effort: if it
 * fails, keyword search still works and the cron can backfill later.
 */
export async function indexDocument(
  deps: SearchDeps,
  doc: { id: string; userId: string; courseId: string | null },
  sections: DocSection[],
) {
  const old = await deps.db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(eq(chunks.userId, doc.userId), eq(chunks.documentId, doc.id)));
  if (old.length && deps.vectors) {
    await deps.vectors.deleteByIds(old.map((o) => o.id)).catch(() => {});
  }
  await deps.db
    .delete(chunks)
    .where(and(eq(chunks.userId, doc.userId), eq(chunks.documentId, doc.id)));
  const drafts = chunkSections(sections);
  if (!drafts.length) return { chunks: 0, embedded: 0 };
  const rows: { id: string; draft: ChunkDraft }[] = [];
  for (let i = 0; i < drafts.length; i += 200) {
    const batch = drafts.slice(i, i + 200);
    const inserted = await deps.db
      .insert(chunks)
      .values(
        batch.map((d) => ({
          ...d,
          userId: doc.userId,
          documentId: doc.id,
          courseId: doc.courseId,
        })),
      )
      .returning({ id: chunks.id, position: chunks.position });
    for (const r of inserted) {
      const draft = batch.find((d) => d.position === r.position);
      if (draft) rows.push({ id: r.id, draft });
    }
  }
  let embedded = 0;
  if (deps.embed && deps.vectors) {
    try {
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const vectors = await deps.embed(batch.map((r) => embedText(r.draft)));
        await deps.vectors.upsert(
          batch.map((r, j) => ({
            id: r.id,
            values: vectors[j] ?? [],
            metadata: {
              userId: doc.userId,
              documentId: doc.id,
              ...(doc.courseId ? { courseId: doc.courseId } : {}),
            },
          })),
        );
        await deps.db
          .update(chunks)
          .set({ embeddedAt: new Date() })
          .where(
            inArray(
              chunks.id,
              batch.map((r) => r.id),
            ),
          );
        embedded += batch.length;
      }
    } catch (err) {
      console.warn(
        JSON.stringify({ msg: "embedding failed", documentId: doc.id, error: String(err) }),
      );
    }
  }
  return { chunks: rows.length, embedded };
}

/** Removes a document's vectors (rows go with the document via cascade). */
export async function unindexDocument(deps: SearchDeps, userId: string, documentId: string) {
  if (!deps.vectors) return;
  const ids = await deps.db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(eq(chunks.userId, userId), eq(chunks.documentId, documentId)));
  if (ids.length) await deps.vectors.deleteByIds(ids.map((r) => r.id)).catch(() => {});
}

/**
 * A prefix-aware tsquery from free text, built only from letters/digits so no
 * user input reaches tsquery syntax: "binary sea" -> 'binary' & 'sea':*.
 * "any" ORs the terms (for natural-language questions, ranked by relevance).
 */
export function prefixQuery(q: string, match: "all" | "any" = "all") {
  const words = q
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  if (!words.length) return null;
  return words
    .map((w, i) => (i === words.length - 1 ? `${w}:*` : w))
    .join(match === "all" ? " & " : " | ");
}

type Filters = {
  userId: string;
  courseId?: string;
  documentId?: string;
  /** "all" for the search box, "any" for questions (Ask). */
  match?: "all" | "any";
};

/** Reciprocal-rank fusion: robust merge of differently-scaled rankings. */
export function rrf(lists: string[][], k = 60) {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Hybrid search over the user's chunks: Postgres full text (prefix-aware) and,
 * when available, Vectorize semantic search, merged with RRF.
 */
export async function searchChunks(
  deps: SearchDeps,
  q: string,
  f: Filters,
  limit = 20,
): Promise<{ hits: SearchHit[]; mode: "hybrid" | "keyword" }> {
  const tsq = prefixQuery(q, f.match);
  const scope = and(
    eq(chunks.userId, f.userId),
    f.courseId ? eq(chunks.courseId, f.courseId) : undefined,
    f.documentId ? eq(chunks.documentId, f.documentId) : undefined,
  );
  const keyword = tsq
    ? await deps.db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(scope, sql`${chunks.tsv} @@ to_tsquery('english', ${tsq})`))
        .orderBy(sql`ts_rank_cd(${chunks.tsv}, to_tsquery('english', ${tsq})) desc`)
        .limit(50)
    : [];

  let semantic: string[] = [];
  let mode: "hybrid" | "keyword" = "keyword";
  if (deps.embed && deps.vectors) {
    try {
      const [vector] = await deps.embed([q]);
      if (vector) {
        const res = await deps.vectors.query(vector, {
          topK: 30,
          filter: {
            userId: f.userId,
            ...(f.courseId ? { courseId: f.courseId } : {}),
            ...(f.documentId ? { documentId: f.documentId } : {}),
          },
        });
        // Weak semantic matches are noise for short queries.
        semantic = res.matches.filter((m) => m.score >= 0.45).map((m) => m.id);
        mode = "hybrid";
      }
    } catch (err) {
      console.warn(JSON.stringify({ msg: "semantic search failed", error: String(err) }));
    }
  }

  const ranked = rrf([keyword.map((k) => k.id), semantic]).slice(0, limit);
  if (!ranked.length) return { hits: [], mode };
  const ids = ranked.map(([id]) => id);
  const headline = tsq
    ? sql<string>`ts_headline('english', ${chunks.text}, to_tsquery('english', ${tsq}), ${`StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`})`
    : sql<string>`left(${chunks.text}, 240)`;
  const rows = await deps.db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      documentTitle: documents.title,
      courseId: chunks.courseId,
      courseName: courses.name,
      anchorKind: chunks.anchorKind,
      anchorN: chunks.anchorN,
      heading: chunks.heading,
      snippet: headline,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .leftJoin(courses, eq(courses.id, chunks.courseId))
    // Vector ids come from Vectorize: re-check ownership here (and drop stale ids).
    .where(and(eq(chunks.userId, f.userId), inArray(chunks.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const [id, score] of ranked) {
    const r = byId.get(id);
    if (!r) continue;
    // One result per page/slide: overlapping chunks would repeat the same place.
    const place = `${r.documentId}:${r.anchorKind}:${r.anchorN}`;
    if (seen.has(place)) continue;
    seen.add(place);
    hits.push({
      chunkId: r.id,
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      courseId: r.courseId,
      courseName: r.courseName,
      anchor: { kind: r.anchorKind, n: r.anchorN },
      heading: r.heading,
      snippet: r.snippet,
      score,
    });
  }
  return { hits, mode };
}

/** Courses, documents and assignments whose names match (for "jump to"). */
export async function searchTitles(db: Database, q: string, f: Filters): Promise<TitleMatch[]> {
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const [docs, assigns, crs] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        courseId: documents.courseId,
        courseName: courses.name,
      })
      .from(documents)
      .leftJoin(courses, eq(courses.id, documents.courseId))
      .where(
        and(
          eq(documents.userId, f.userId),
          ilike(documents.title, pattern),
          f.courseId ? eq(documents.courseId, f.courseId) : undefined,
        ),
      )
      .limit(5),
    db
      .select({
        id: assignments.id,
        title: assignments.name,
        courseId: assignments.courseId,
        courseName: courses.name,
      })
      .from(assignments)
      .innerJoin(courses, eq(courses.id, assignments.courseId))
      .where(
        and(
          eq(assignments.userId, f.userId),
          ilike(assignments.name, pattern),
          f.courseId ? eq(assignments.courseId, f.courseId) : undefined,
        ),
      )
      .limit(5),
    f.courseId
      ? Promise.resolve([])
      : db
          .select({ id: courses.id, title: courses.name })
          .from(courses)
          .where(
            and(
              eq(courses.userId, f.userId),
              eq(courses.selected, true),
              or(ilike(courses.name, pattern), ilike(courses.courseCode, pattern)),
            ),
          )
          .limit(3),
  ]);
  return [
    ...crs.map((c) => ({
      kind: "course" as const,
      id: c.id,
      title: c.title,
      courseId: c.id,
      courseName: c.title,
    })),
    ...docs.map((d) => ({ kind: "document" as const, ...d })),
    ...assigns.map((a) => ({ kind: "assignment" as const, ...a })),
  ];
}
