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
  /** 추론 깊이 (fast/balanced/deep). 서버가 모델별 API 레벨로 변환한다. */
  effort: string;
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

export function useChat({ projectId, model, effort }: Options) {
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

      // 스트리밍 텍스트 배칭: text_delta 토큰마다 setTurns 를 호출하면 turns 배열
      // 전체가 매번 새로 만들어져 루트(Home)~Header/SessionTree/FileViewer 까지 전부
      // 리렌더된다. 토큰은 ref 에 누적해 두고 rAF 로 한 프레임에 한 번만 flush 한다.
      // 비-텍스트 이벤트/스트림 종료 시점에는 즉시 flush 해 순서/누락이 없게 한다.
      let pendingText = "";
      let rafId: number | null = null;
      const flushText = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (pendingText === "") return;
        const chunk = pendingText;
        pendingText = "";
        // flush 시점에 비활성이면(전환됨) 누적분을 버린다(오염 방지).
        if (!isActive()) return;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, text: t.text + chunk } : t,
          ),
        );
      };
      const scheduleFlush = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          flushText();
        });
      };

      // 이 send 가 여전히 "활성(최신)" 인지 판별하는 기준. stop()/reset() 또는
      // 다음 send 가 abortRef 를 교체하면 이 컨트롤러는 더 이상 활성이 아니다.
      // 비활성이 된 send 의 SSE 콜백은 상태(setCurrentSessionId/setTurns)를 건드리면
      // 안 된다(이전 스트림이 새 화면의 세션 ID/턴을 덮어쓰는 오염 방지).
      const isActive = () => abortRef.current === controller;

      // Consume the new-session / resume intent for this single send.
      const consumedNewSession = newSessionPendingRef.current;
      const consumedResumeId = resumeSessionIdRef.current;
      newSessionPendingRef.current = false;
      resumeSessionIdRef.current = null;
      // 서버가 실제로 세션을 시작했는지(첫 session SSE 이벤트 수신 여부) 추적.
      // 실패/중단/HTTP오류로 빠질 때, 세션을 아직 못 받았다면 위에서 소비한
      // new-session/resume 의도를 원복해 다음 메시지가 엉뚱한 세션에 붙지 않게 한다.
      let sessionStarted = false;
      const restoreIntentIfNeeded = () => {
        if (sessionStarted) return;
        // 그 사이 다음 send/loadTurns/resumeSession 등이 새 의도를 세팅했다면 덮지 않는다.
        if (newSessionPendingRef.current || resumeSessionIdRef.current !== null) {
          return;
        }
        newSessionPendingRef.current = consumedNewSession;
        resumeSessionIdRef.current = consumedResumeId;
      };

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
              // 전송 자체를 포기 → 세션 미시작이므로 소비한 의도 원복.
              restoreIntentIfNeeded();
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
            effort,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // 세션 미시작 상태로 실패 → 소비한 의도 원복(재전송이 올바른 세션을 타게).
          restoreIntentIfNeeded();
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j.error) msg = j.error;
          } catch {
            /* ignore */
          }
          // 이미 비활성(전환됨)이면 새 화면의 턴을 건드리지 않는다.
          if (isActive()) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId
                  ? { ...t, isStreaming: false, error: msg }
                  : t,
              ),
            );
          }
          return;
        }

        for await (const evtUnknown of parseSSE(res)) {
          const evt = evtUnknown as ServerEvent;
          // 세션 이벤트는 활성 여부와 무관하게 "시작됨" 으로 기록한다(원복 방지용).
          if (evt.type === "session") sessionStarted = true;
          // 이 send 가 더 이상 활성이 아니면(프로젝트/세션 전환됨) 상태 갱신 금지.
          // 이전 스트림이 새 화면의 세션 ID/턴을 덮어쓰는 오염을 막는다.
          if (!isActive()) continue;
          if (evt.type === "session") {
            // 비-텍스트 이벤트: 누적 텍스트를 먼저 flush 해 순서를 보존한다.
            flushText();
            setCurrentSessionId(evt.sessionId);
          } else if (evt.type === "text_delta") {
            // 토큰은 ref 에 누적하고 rAF 로 한 프레임에 한 번만 setTurns flush.
            pendingText += evt.text;
            scheduleFlush();
          } else if (evt.type === "tool_use_start") {
            // tool 이벤트 전에 누적 텍스트를 flush(텍스트→tool 순서 보존).
            flushText();
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
            flushText();
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
            flushText();
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
            // 종료 직전 남은 토큰을 즉시 flush(마지막 토큰 누락 방지).
            flushText();
            setTurns((prev) =>
              prev.map((t) => (t.id === assistantId ? { ...t, isStreaming: false } : t)),
            );
          } else if (evt.type === "error") {
            flushText();
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
        // 세션 미시작 상태로 빠진 모든 경로(중단/네트워크 오류 등)는 의도를 원복.
        // 이미 세션이 시작된 뒤의 중단이면 원복하지 않는다(그 세션을 정상 이어가야 함).
        restoreIntentIfNeeded();
        // 비활성(전환됨)이면 이전 화면 턴을 건드리지 않는다.
        if (isActive()) {
          if ((e as Error).name === "AbortError") {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId ? { ...t, isStreaming: false } : t,
              ),
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
        }
      } finally {
        // 어떤 경로로 끝나든(정상/중단/오류) 남은 누적 토큰을 즉시 flush 하고
        // 예약된 rAF 를 정리한다. flushText 내부에서 isActive() 가드로 비활성
        // 스트림의 잔여 텍스트는 버려진다(오염 방지). 중단(stop) 시점에는
        // abortRef 가 아직 이 컨트롤러라 활성으로 간주되어 부분 응답이 보존된다.
        flushText();
        // 이 send 가 여전히 활성일 때만 busy 해제/abortRef 정리.
        // (이미 다음 send/stop 이 abortRef 를 교체했다면 그쪽이 관리한다.)
        if (isActive()) {
          setBusy(false);
          abortRef.current = null;
        }
      }
    },
    [projectId, model, effort],
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
