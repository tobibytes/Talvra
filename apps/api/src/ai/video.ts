import type { StudyNotes, Video } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, desc, eq, schema } from "@talvra/db";
import type { FileStore } from "../ingest/process.js";

const { videos, studyAids, documents } = schema;

export type VideoMessage = { type: "video"; userId: string; videoId: string };

export type ScriptSlide = { heading: string; bullets: string[]; narration: string };

/** Text to speech: returns encoded audio (mp3) for one slide's narration. */
export type Speaker = (text: string) => Promise<Uint8Array>;
/** Renders slides + audio into an MP4 (the media container). */
export type Renderer = (input: {
  title: string;
  slides: { heading: string; bullets: string[]; audio: Uint8Array }[];
}) => Promise<{ mp4: Uint8Array; durations: number[] }>;

export class VideoError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SLIDES = 14;

/**
 * Slides and narration from study notes: a title slide, one per section (up to
 * five points each), and a key-terms recap. No extra model call.
 */
export function scriptFromNotes(notes: StudyNotes): ScriptSlide[] {
  const slides: ScriptSlide[] = [
    { heading: notes.title, bullets: [], narration: `${notes.title}. ${notes.summary}` },
  ];
  for (const s of notes.sections.slice(0, MAX_SLIDES - 2)) {
    const bullets = s.bullets.slice(0, 5).map((b) => b.text);
    slides.push({ heading: s.heading, bullets, narration: `${s.heading}. ${bullets.join(" ")}` });
  }
  if (notes.keyTerms.length) {
    const terms = notes.keyTerms.slice(0, 6);
    slides.push({
      heading: "Key terms",
      bullets: terms.map((t) => `${t.term}: ${t.definition}`),
      narration: `Key terms to remember. ${terms.map((t) => `${t.term}: ${t.definition}`).join(" ")}`,
    });
  }
  // Long narration makes long slides; keep each under ~90 seconds of speech.
  return slides.map((s) => ({ ...s, narration: s.narration.slice(0, 1400) }));
}

/** Workers AI returns audio in a few shapes depending on runtime; accept all of them. */
async function toBytes(out: unknown): Promise<Uint8Array> {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof Response) return new Uint8Array(await out.arrayBuffer());
  const b64 = typeof out === "string" ? out : (out as { audio?: unknown } | null)?.audio;
  if (typeof b64 === "string") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  throw new VideoError(true, "Text-to-speech returned no audio.");
}

export function workersAiSpeaker(ai: Ai): Speaker {
  return async (text) => {
    try {
      return await toBytes(
        await ai.run("@cf/deepgram/aura-2-en", { text, speaker: "luna", encoding: "mp3" }),
      );
    } catch (err) {
      if (err instanceof VideoError) throw err;
      console.warn(JSON.stringify({ msg: "tts failed", error: String(err) }));
      throw new VideoError(true, "Narration is busy right now. Trying again shortly.");
    }
  };
}

/** Azure Speech (REST), used when AZURE_SPEECH_KEY is configured. */
export function azureSpeaker(
  key: string,
  region: string,
  voice = "en-US-AvaMultilingualNeural",
): Speaker {
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return async (text) => {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Talvra",
      },
      body: `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${esc(text)}</voice></speak>`,
    });
    if (!res.ok)
      throw new VideoError(
        res.status >= 500 || res.status === 429,
        `Azure TTS returned ${res.status}.`,
      );
    return new Uint8Array(await res.arrayBuffer());
  };
}

/** Calls the media container (or any HTTP endpoint running apps/media). */
export function httpRenderer(
  send: (req: Request) => Promise<Response>,
  url: string,
  secret?: string,
): Renderer {
  return async ({ title, slides }) => {
    const b64 = (u: Uint8Array) => {
      let s = "";
      for (let i = 0; i < u.length; i += 0x8000)
        s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const headers = new Headers({ "content-type": "application/json" });
    if (secret) headers.set("authorization", `Bearer ${secret}`);
    const res = await send(
      new Request(url, {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers,
        body: JSON.stringify({
          title,
          slides: slides.map((s) => ({
            heading: s.heading,
            bullets: s.bullets,
            audio_b64: b64(s.audio),
          })),
        }),
      }),
    ).catch((err) => {
      console.warn(JSON.stringify({ msg: "media service unreachable", error: String(err) }));
      throw new VideoError(true, "The video maker is busy. Trying again shortly.");
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new VideoError(
        res.status >= 500,
        body?.error?.message ?? `Media service returned ${res.status}.`,
      );
    }
    const durations = (res.headers.get("x-slide-durations") ?? "")
      .split(",")
      .map(Number)
      .filter(Number.isFinite);
    return { mp4: new Uint8Array(await res.arrayBuffer()), durations };
  };
}

const vttTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
};

/** WebVTT captions: each slide's narration split into ~12-word cues across its time. */
export function captions(slides: ScriptSlide[], durations: number[]) {
  let t = 0;
  const cues: string[] = [];
  slides.forEach((s, i) => {
    const dur = durations[i] ?? 0;
    const words = s.narration.split(/\s+/).filter(Boolean);
    const groups: string[] = [];
    for (let j = 0; j < words.length; j += 12) groups.push(words.slice(j, j + 12).join(" "));
    const speaking = Math.max(dur - 0.6, 0.5);
    groups.forEach((g, k) => {
      const start = t + (speaking * k) / groups.length;
      const end = t + (speaking * (k + 1)) / groups.length;
      cues.push(`${vttTime(start)} --> ${vttTime(end)}\n${g.replace(/-->/g, "→")}`);
    });
    t += dur;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function toVideo(v: typeof videos.$inferSelect): Video {
  return {
    id: v.id,
    documentId: v.documentId,
    status: v.status,
    durationSeconds: v.durationSeconds,
    error: v.error,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export const videoKeys = (userId: string, documentId: string, videoId: string) => ({
  mp4: `u/${userId}/d/${documentId}/video-${videoId}.mp4`,
  vtt: `u/${userId}/d/${documentId}/video-${videoId}.vtt`,
});

export type VideoDeps = {
  db: Database;
  files: FileStore;
  speak: Speaker;
  render: Renderer;
  notify?: (userId: string, v: Video) => Promise<void>;
};

/** Queue job: notes → narration audio → MP4 + captions in R2. */
export async function renderVideo(
  deps: VideoDeps,
  { userId, videoId }: Omit<VideoMessage, "type">,
  attempt = 1,
) {
  const [v] = await deps.db
    .select()
    .from(videos)
    .where(and(eq(videos.userId, userId), eq(videos.id, videoId)))
    .limit(1);
  if (!v || v.status === "ready") return "skipped" as const;
  const save = async (patch: Partial<typeof videos.$inferInsert>) => {
    const [row] = await deps.db
      .update(videos)
      .set(patch)
      .where(and(eq(videos.userId, userId), eq(videos.id, videoId)))
      .returning();
    if (row) await deps.notify?.(userId, toVideo(row)).catch(() => {});
  };
  try {
    const [notes] = await deps.db
      .select({ content: studyAids.content, id: studyAids.id })
      .from(studyAids)
      .where(
        and(
          eq(studyAids.userId, userId),
          eq(studyAids.documentId, v.documentId),
          eq(studyAids.kind, "notes"),
          eq(studyAids.status, "ready"),
        ),
      )
      .orderBy(desc(studyAids.version))
      .limit(1);
    if (!notes?.content)
      throw new VideoError(false, "Make study notes first; the video is built from them.");
    const [doc] = await deps.db
      .select({ title: documents.title })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.id, v.documentId)))
      .limit(1);
    await save({ status: "rendering", error: null, aidId: notes.id });
    const script = scriptFromNotes(notes.content as StudyNotes);
    const audio: Uint8Array[] = [];
    for (const s of script) audio.push(await deps.speak(s.narration));
    const out = await deps.render({
      title: doc?.title ?? "Talvra",
      slides: script.map((s, i) => ({
        heading: s.heading,
        bullets: s.bullets,
        audio: audio[i] ?? new Uint8Array(),
      })),
    });
    const keys = videoKeys(userId, v.documentId, v.id);
    await deps.files.put(keys.mp4, out.mp4, { httpMetadata: { contentType: "video/mp4" } });
    await deps.files.put(keys.vtt, captions(script, out.durations), {
      httpMetadata: { contentType: "text/vtt; charset=utf-8" },
    });
    await save({
      status: "ready",
      r2Key: keys.mp4,
      captionsKey: keys.vtt,
      sizeBytes: out.mp4.byteLength,
      durationSeconds: Math.round(out.durations.reduce((a, b) => a + b, 0)),
    });
    return "ready" as const;
  } catch (err) {
    const retryable = err instanceof VideoError ? err.retryable : true;
    if (retryable && attempt < 3) {
      await save({ status: "queued" });
      throw new VideoError(true, String((err as Error).message));
    }
    await save({
      status: "failed",
      error: err instanceof VideoError ? err.message : "Couldn't make the video. Try again later.",
    });
    if (!(err instanceof VideoError))
      console.error(JSON.stringify({ msg: "video failed", error: String(err) }));
    return "failed" as const;
  }
}
