"use client";

import { useCallback, useRef, useState } from "react";
import { parseSSE } from "@/lib/client/sse";
import { apiUrl } from "@/lib/client/url";
import type { Attachment, ChatTurn, ToolCallView } from "@/lib/client/types";

type ServerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input"; id: string; input: Record<string, unknown> }
  | { type: "tool_use_result"; id: string; output: string; is_error?: boolean }
  | { type: "turn_complete"; stop_reason: string | null }
  | { type: "done" }
  | { type: "error"; message: string };

type Options = {
  projectId: string;
  /** Anthropic model ID to send with each request (e.g. "claude-sonnet-4-6"). */
  model: string;
};

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function uploadFiles(
  files: File[],
  projectId: string,
): Promise<{
  attachments: Attachment[];
  errors: { name: string; error: string }[];
}> {
  if (files.length === 0) return { attachments: [], errors: [] };
  const form = new FormData();
  form.append("projectId", projectId);
  for (const f of files) form.append("files", f, f.name);
  const r = await fetch(apiUrl("/api/upload"), {
    method: "POST",
    body: form,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `업로드 실패 (HTTP ${r.status})`);
  }
  const j = (await r.json()) as {
    attachments: Attachment[];
    errors: { name: string; error: string }[];
  };
  return j;
}

export function useChat({ projectId, model }: Options) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  /** The session ID we're currently writing into. Server tells us via SSE. */
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** When set, the next send call will tell the server to start a fresh session. */
  const newSessionPendingRef = useRef(false);
  /** When set, the next send call will tell the server to resume this past session. */
  const resumeSessionIdRef = useRef<string | null>(null);

  const send = useCallback(
    async (text: string, files?: File[]) => {
      const filesToUpload = files ?? [];
      const userId = newId();
      const assistantId = newId();

      const userTurn: ChatTurn = {
        id: userId,
        role: "user",
        text,
        toolCalls: [],
      };
      const assistantTurn: ChatTurn = {
        id: assistantId,
        role: "assistant",
        text: "",
        toolCalls: [],
        isStreaming: true,
      };

      setTurns((prev) => [...prev, userTurn, assistantTurn]);

      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      // Consume the new-session / resume intent for this single send.
      const consumedNewSession = newSessionPendingRef.current;
      const consumedResumeId = resumeSessionIdRef.current;
      newSessionPendingRef.current = false;
      resumeSessionIdRef.current = null;

      try {
        let attachments: Attachment[] = [];
        if (filesToUpload.length > 0) {
          const { attachments: ok, errors } = await uploadFiles(
            filesToUpload,
            projectId,
          );
          attachments = ok;
          if (ok.length > 0) {
            setTurns((prev) =>
              prev.map((t) => (t.id === userId ? { ...t, attachments: ok } : t)),
            );
          }
          if (errors.length > 0) {
            const errText = errors
              .map((e) => `${e.name}: ${e.error}`)
              .join("\n");
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? { ...t, error: `일부 파일 업로드 실패:\n${errText}` }
                  : t,
              ),
            );
            if (ok.length === 0 && !text.trim()) {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === assistantId ? { ...t, isStreaming: false } : t,
                ),
              );
              return;
            }
          }
        }

        const res = await fetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            attachments,
            projectId,
            newSession: consumedNewSession,
            resumeSessionId: consumedResumeId,
            model,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j.error) msg = j.error;
          } catch {
            /* ignore */
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId ? { ...t, isStreaming: false, error: msg } : t,
            ),
          );
          return;
        }

        for await (const evtUnknown of parseSSE(res)) {
          const evt = evtUnknown as ServerEvent;
          if (evt.type === "session") {
            setCurrentSessionId(evt.sessionId);
          } else if (evt.type === "text_delta") {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId ? { ...t, text: t.text + evt.text } : t,
              ),
            );
          } else if (evt.type === "tool_use_start") {
            const newCall: ToolCallView = {
              id: evt.id,
              name: evt.name,
              input: null,
              startedAt: Date.now(),
            };
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? { ...t, toolCalls: [...t.toolCalls, newCall] }
                  : t,
              ),
            );
          } else if (evt.type === "tool_use_input") {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? {
                      ...t,
                      toolCalls: t.toolCalls.map((c) =>
                        c.id === evt.id ? { ...c, input: evt.input } : c,
                      ),
                    }
                  : t,
              ),
            );
          } else if (evt.type === "tool_use_result") {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? {
                      ...t,
                      toolCalls: t.toolCalls.map((c) =>
                        c.id === evt.id
                          ? { ...c, output: evt.output, isError: evt.is_error }
                          : c,
                      ),
                    }
                  : t,
              ),
            );
          } else if (evt.type === "done") {
            setTurns((prev) =>
              prev.map((t) => (t.id === assistantId ? { ...t, isStreaming: false } : t)),
            );
          } else if (evt.type === "error") {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? { ...t, isStreaming: false, error: evt.message }
                  : t,
              ),
            );
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantId ? { ...t, isStreaming: false } : t)),
          );
        } else {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId
                ? {
                    ...t,
                    isStreaming: false,
                    error: e instanceof Error ? e.message : String(e),
                  }
                : t,
            ),
          );
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [projectId, model],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setTurns([]);
    setCurrentSessionId(null);
    // CRITICAL: also clear any pending resume/new-session intents. Otherwise a
    // session ID set by a prior project's loadTurns/resumeSession would leak
    // into the next send on the new project and the server would try to
    // resume a session that doesn't exist in the new cwd
    // ("No conversation found with session ID …").
    resumeSessionIdRef.current = null;
    newSessionPendingRef.current = false;
  }, []);

  /** Set the active session ID without resetting turns (e.g. after resume load). */
  const setSessionId = useCallback((id: string | null) => {
    setCurrentSessionId(id);
  }, []);

  /**
   * Replace the chat history (e.g. after fetching a past session's turns
   * from the server). Also pins the current session ID so the next message
   * appends to the same session naturally.
   */
  const loadTurns = useCallback((next: ChatTurn[], sessionId: string) => {
    setTurns(next);
    setCurrentSessionId(sessionId);
    // The next user message should resume into this session.
    resumeSessionIdRef.current = sessionId;
    newSessionPendingRef.current = false;
  }, []);

  /**
   * Mark the *next* send as a fresh agent session (server uses continue:false once).
   * Pair with `reset()` to also clear the in-UI turn history.
   */
  const startNewSession = useCallback(() => {
    newSessionPendingRef.current = true;
    resumeSessionIdRef.current = null;
  }, []);

  /**
   * Mark the *next* send as resuming a specific past session (by UUID).
   * Pair with `reset()` to clear the in-UI turn history first.
   */
  const resumeSession = useCallback((sessionId: string) => {
    resumeSessionIdRef.current = sessionId;
    newSessionPendingRef.current = false;
  }, []);

  return {
    turns,
    busy,
    send,
    stop,
    reset,
    startNewSession,
    resumeSession,
    loadTurns,
    currentSessionId,
    setSessionId,
  };
}
