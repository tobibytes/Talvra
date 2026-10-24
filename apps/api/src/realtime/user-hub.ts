import { DurableObject } from "cloudflare:workers";
import type { AidEvent, DocumentEvent, SyncRun } from "@talvra/contracts";
import type { Bindings } from "../env.js";

/**
 * One per user (`idFromName(userId)`). Holds the user's open WebSockets with
 * the Hibernation API, remembers the latest sync snapshot so a fresh
 * connection gets current state immediately, and broadcasts updates.
 *
 * Only the Worker talks to it: the Worker authenticates the session and picks
 * the id. Clients never choose which hub they connect to.
 */
export class UserHub extends DurableObject<Bindings> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const last = await this.ctx.storage.get<SyncRun>("lastRun");
    if (last) server.send(JSON.stringify({ type: "run", run: last }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC from the sync Workflow. */
  async publish(run: SyncRun) {
    await this.ctx.storage.put("lastRun", run);
    const message = JSON.stringify({ type: "run", run });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Socket already closing; the runtime cleans it up.
      }
    }
  }

  /** RPC from the ingest consumer. Not stored: pages refetch when they connect. */
  async publishDocument(document: DocumentEvent) {
    const message = JSON.stringify({ type: "document", document });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Socket already closing.
      }
    }
  }

  /** RPC from the study-aid consumer. */
  async publishAid(aid: AidEvent) {
    const message = JSON.stringify({ type: "aid", aid });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Socket already closing.
      }
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send(JSON.stringify({ type: "ping" }));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
