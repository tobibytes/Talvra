import {
  type CourseDocumentList,
  type DocumentEvent,
  SyncLiveMessage,
  type SyncRun,
} from "@talvra/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { api } from "@/lib/api";

export const latestRunQuery = queryOptions({
  queryKey: ["sync", "latest"],
  queryFn: async () => (await api.syncRuns(1)).items[0] ?? null,
});

export const isActive = (run: SyncRun | null | undefined) =>
  run?.status === "queued" || run?.status === "running";

/**
 * Keeps ["sync", "latest"] fresh over the /sync/live WebSocket and refreshes
 * course data as courses finish. Reconnects with exponential backoff. While a
 * run is active and the socket is down, the query polls as a fallback.
 * Mount once (the app shell and onboarding do).
 */
export function useSyncLive() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (typeof WebSocket === "undefined") return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const onRun = (run: SyncRun) => {
      const prev = queryClient.getQueryData(latestRunQuery.queryKey);
      if (prev && prev.id !== run.id && prev.createdAt > run.createdAt) return; // stale snapshot
      queryClient.setQueryData(latestRunQuery.queryKey, run);
      const wasDone = new Set(
        prev?.id === run.id
          ? (prev.progress?.courses ?? []).filter((c) => c.state === "done").map((c) => c.courseId)
          : [],
      );
      for (const c of run.progress?.courses ?? []) {
        if (c.state === "done" && !wasDone.has(c.courseId)) {
          void queryClient.invalidateQueries({ queryKey: ["course", c.courseId] });
        }
      }
      if (!isActive(run) && prev?.status !== run.status) {
        void queryClient.invalidateQueries({ queryKey: ["courses"] });
        void queryClient.invalidateQueries({ queryKey: ["sync", "runs"] });
      }
    };

    // Patch the status in place (instant), then refetch the detail if it's open.
    const onDocument = (doc: DocumentEvent) => {
      if (doc.courseId) {
        queryClient.setQueryData<CourseDocumentList>(
          ["course", doc.courseId, "documents"],
          (list) =>
            list && {
              items: list.items.map((d) => (d.id === doc.id ? { ...d, status: doc.status } : d)),
            },
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["document", doc.id] });
      if (doc.status === "ready" || doc.status === "failed" || doc.status === "unsupported") {
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
      }
    };

    const connect = () => {
      const url = new URL("/api/v1/sync/live", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        ping = setInterval(() => socket?.readyState === 1 && socket.send("ping"), 30_000);
      };
      socket.onmessage = (event) => {
        try {
          const msg = SyncLiveMessage.parse(JSON.parse(String(event.data)));
          if (msg.type === "run") onRun(msg.run);
          if (msg.type === "document") onDocument(msg.document);
          if (msg.type === "aid") {
            void queryClient.invalidateQueries({
              queryKey: ["document", msg.aid.documentId, "aids"],
            });
            if (msg.aid.status === "ready" && msg.aid.kind === "flashcards") {
              void queryClient.invalidateQueries({ queryKey: ["study"] });
            }
          }
        } catch {
          // Ignore malformed messages.
        }
      };
      socket.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++) * (0.5 + Math.random() / 2);
        reconnect = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      clearInterval(ping);
      socket?.close();
    };
  }, [queryClient]);

  return connected;
}

const LiveContext = React.createContext(false);

/** Opens the live connection for everything inside it. */
export function SyncLiveProvider({ children }: { children: React.ReactNode }) {
  const connected = useSyncLive();
  return React.createElement(LiveContext.Provider, { value: connected }, children);
}

/** The latest run. Polls every 3s while one is active and the socket isn't connected. */
export function useLatestRun() {
  const liveConnected = React.useContext(LiveContext);
  return useQuery({
    ...latestRunQuery,
    refetchInterval: (q) => (isActive(q.state.data) && !liveConnected ? 3000 : false),
  });
}
