import type { AidEvent, DocumentEvent, SyncRun, Video } from "@talvra/contracts";
import type { Bindings } from "../env.js";

/** The user's hub. The id always comes from the authenticated user id. */
export function hubFor(env: Bindings, userId: string) {
  if (!env.USER_HUB) return null;
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId));
}

export async function publishToHub(env: Bindings, userId: string, run: SyncRun) {
  await hubFor(env, userId)?.publish(run);
}

export async function publishDocumentToHub(env: Bindings, userId: string, doc: DocumentEvent) {
  await hubFor(env, userId)?.publishDocument(doc);
}

export async function publishAidToHub(env: Bindings, userId: string, aid: AidEvent) {
  await hubFor(env, userId)?.publishAid(aid);
}

export async function publishVideoToHub(env: Bindings, userId: string, video: Video) {
  await hubFor(env, userId)?.publishVideo(video);
}
