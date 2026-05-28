"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  FolderGit2,
  FolderInput,
  MessageSquarePlus,
  MessageSquare,
  RotateCw,
  Dot,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import type { Project } from "@/lib/client/types";

type SessionSummary = {
  id: string;
  startedAt: number;
  updatedAt: number;
  bytes: number;
  firstUserMessage: string | null;
};

type Props = {
  projects: Project[];
  activeProjectId: string;
  /** ID of the session currently in the chat panel (null = brand-new not-yet-sent). */
  activeSessionId: string | null;
  /** Bumps after each agent turn so we re-fetch the session list. */
  reloadNonce?: number;
  onSelectProject: (id: string) => void;
  /** Resume a specific past session of a project. */
  onSelectSession: (projectId: string, sessionId: string) => void;
  /** Start a new session in the given project. */
  onNewSession: (projectId: string) => void;
  onRefresh: () => void;
  loading?: boolean;
};

export function SessionTree({
  projects,
  activeProjectId,
  activeSessionId,
  reloadNonce,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onRefresh,
  loading,
}: Props) {
  return (
    <aside className="flex h-full flex-col border-r border-border bg-bg-elevated">
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          세션
        </span>
        <button
          onClick={onRefresh}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-fg"
          title="새로고침"
          aria-label="새로고침"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {projects.length === 0 ? (
          <div className="px-4 py-4 text-xs text-fg-subtle">프로젝트가 없습니다.</div>
        ) : (
          projects.map((p) => (
            <ProjectGroup
              key={p.id}
              project={p}
              expanded={p.id === activeProjectId}
              activeSessionId={p.id === activeProjectId ? activeSessionId : null}
              reloadNonce={reloadNonce}
              onActivate={() => onSelectProject(p.id)}
              onSelectSession={(sid) => onSelectSession(p.id, sid)}
              onNewSession={() => onNewSession(p.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ProjectGroup({
  project,
  expanded,
  activeSessionId,
  reloadNonce,
  onActivate,
  onSelectSession,
  onNewSession,
}: {
  project: Project;
  expanded: boolean;
  activeSessionId: string | null;
  reloadNonce?: number;
  onActivate: () => void;
  onSelectSession: (sid: string) => void;
  onNewSession: () => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!expanded) return;
    setLoading(true);
    try {
      const r = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(project.id)}/sessions`),
      );
      if (!r.ok) {
        setSessions([]);
        return;
      }
      const j = (await r.json()) as { sessions: SessionSummary[] };
      setSessions(j.sessions);
    } finally {
      setLoading(false);
    }
  }, [expanded, project.id]);

  // Re-fetch whenever the active turn ends or we get expanded for the first time.
  useEffect(() => {
    if (expanded) loadSessions();
  }, [expanded, reloadNonce, loadSessions]);

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 ${expanded ? "bg-navy/5" : ""}`}
      >
        <button
          onClick={onActivate}
          className="flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-bg-sunken"
          title={project.root}
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-fg-subtle transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          {project.external ? (
            <FolderInput
              className={`h-3.5 w-3.5 shrink-0 ${expanded ? "text-gold" : "text-fg-subtle"}`}
            />
          ) : (
            <FolderGit2
              className={`h-3.5 w-3.5 shrink-0 ${expanded ? "text-gold" : "text-fg-subtle"}`}
            />
          )}
          <span
            className={`truncate text-sm ${expanded ? "font-medium text-fg" : "text-fg-muted"}`}
          >
            {project.name}
          </span>
          {project.external && (
            <span className="shrink-0 rounded bg-gold-soft px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-deep">
              외부
            </span>
          )}
        </button>
        <button
          onClick={onNewSession}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg hover:text-gold-deep"
          title="새 세션 (대화 새로 시작)"
          aria-label="새 세션"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="ml-3 mb-1 mr-1 border-l border-border pl-2">
          {loading && sessions === null ? (
            <div className="px-2 py-1.5 text-[11px] text-fg-subtle">불러오는 중…</div>
          ) : sessions === null || sessions.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-fg-subtle">
              아직 세션이 없습니다.
              <br />
              <span className="text-fg-subtle/70">아래 입력창에 메시지를 보내면 시작됩니다.</span>
            </div>
          ) : (
            <ul className="space-y-0.5 py-0.5">
              {sessions.map((s) => {
                const active = activeSessionId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => onSelectSession(s.id)}
                      className={`group/sess flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${
                        active
                          ? "bg-navy/10 text-fg"
                          : "text-fg-muted hover:bg-bg-sunken hover:text-fg"
                      }`}
                      title={`${s.id}\n${new Date(s.updatedAt).toLocaleString("ko-KR")}`}
                    >
                      {active ? (
                        <Dot
                          className="-ml-1 h-4 w-4 shrink-0 text-gold"
                          strokeWidth={5}
                        />
                      ) : (
                        <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">
                          {s.firstUserMessage || "(빈 세션)"}
                        </span>
                        <span className="block text-[10px] text-fg-subtle">
                          {relativeTime(s.updatedAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "방금 전";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(ms).toLocaleDateString("ko-KR");
}
