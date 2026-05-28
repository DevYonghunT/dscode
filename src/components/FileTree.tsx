"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderGit2,
  FolderInput,
  RotateCw,
  MessageSquarePlus,
  History,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import type { Project, TreeNode } from "@/lib/client/types";

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
  /** Tree for the active project only. */
  tree: TreeNode[];
  selectedPath: string | null;
  /** Bumps after each agent turn so we refresh the session list too. */
  reloadNonce?: number;
  onSelectProject: (id: string) => void;
  onSelectFile: (path: string) => void;
  /** Start a new chat session in the given project. Also activates it. */
  onNewChat: (projectId: string) => void;
  /** Resume a specific past session in the given project. */
  onResumeSession: (projectId: string, sessionId: string) => void;
  onRefresh: () => void;
  loading?: boolean;
};

export function FileTree({
  projects,
  activeProjectId,
  tree,
  selectedPath,
  reloadNonce,
  onSelectProject,
  onSelectFile,
  onNewChat,
  onResumeSession,
  onRefresh,
  loading,
}: Props) {
  return (
    <aside className="flex h-full flex-col border-r border-border bg-bg-elevated">
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          프로젝트
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
              active={p.id === activeProjectId}
              tree={p.id === activeProjectId ? tree : null}
              selectedPath={p.id === activeProjectId ? selectedPath : null}
              reloadNonce={reloadNonce}
              loading={p.id === activeProjectId && loading === true}
              onActivate={() => onSelectProject(p.id)}
              onSelectFile={onSelectFile}
              onNewChat={() => onNewChat(p.id)}
              onResumeSession={(sid) => onResumeSession(p.id, sid)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ProjectGroup({
  project,
  active,
  tree,
  selectedPath,
  reloadNonce,
  loading,
  onActivate,
  onSelectFile,
  onNewChat,
  onResumeSession,
}: {
  project: Project;
  active: boolean;
  tree: TreeNode[] | null;
  selectedPath: string | null;
  reloadNonce?: number;
  loading: boolean;
  onActivate: () => void;
  onSelectFile: (path: string) => void;
  onNewChat: () => void;
  onResumeSession: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!active) return;
    try {
      const r = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(project.id)}/sessions`),
      );
      if (!r.ok) return;
      const j = (await r.json()) as { sessions: SessionSummary[] };
      setSessions(j.sessions);
    } catch {
      /* ignore */
    }
  }, [active, project.id]);

  // Initial load + refresh whenever the agent finishes a turn.
  useEffect(() => {
    if (active) loadSessions();
  }, [active, reloadNonce, loadSessions]);

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 ${active ? "bg-navy/5" : ""}`}
      >
        <button
          onClick={onActivate}
          className="flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-bg-sunken"
          title={project.root}
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-fg-subtle transition-transform ${
              active ? "rotate-90" : ""
            }`}
          />
          {project.external ? (
            <FolderInput
              className={`h-3.5 w-3.5 shrink-0 ${active ? "text-gold" : "text-fg-subtle"}`}
            />
          ) : (
            <FolderGit2
              className={`h-3.5 w-3.5 shrink-0 ${active ? "text-gold" : "text-fg-subtle"}`}
            />
          )}
          <span
            className={`truncate text-sm ${active ? "font-medium text-fg" : "text-fg-muted"}`}
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
          onClick={onNewChat}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-bg hover:text-gold-deep group-hover:opacity-100"
          title="새 채팅 (대화 이력 초기화)"
          aria-label="새 채팅"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {active && (
        <div className="pb-1 pl-2 pr-1">
          {/* Recent sessions toggle */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="mb-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-fg-muted"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showHistory ? "rotate-90" : ""}`}
            />
            <History className="h-3 w-3" />
            <span>최근 세션{sessions ? ` (${sessions.length})` : ""}</span>
          </button>
          {showHistory && (
            <div className="mb-2 ml-2 space-y-0.5 border-l border-border pl-2">
              {sessions === null ? (
                <div className="px-2 py-1 text-[11px] text-fg-subtle">불러오는 중…</div>
              ) : sessions.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-fg-subtle">없음</div>
              ) : (
                sessions.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onResumeSession(s.id)}
                    className="block w-full rounded px-1.5 py-1 text-left transition-colors hover:bg-bg-sunken"
                    title={`${new Date(s.updatedAt).toLocaleString("ko-KR")}`}
                  >
                    <div className="truncate text-xs text-fg-muted">
                      {s.firstUserMessage || "(빈 세션)"}
                    </div>
                    <div className="truncate text-[10px] text-fg-subtle">
                      {relativeTime(s.updatedAt)}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Files */}
          {loading && (!tree || tree.length === 0) ? (
            <div className="px-3 py-2 text-xs text-fg-subtle">불러오는 중…</div>
          ) : tree && tree.length > 0 ? (
            tree.map((n) => (
              <TreeRow
                key={n.path}
                node={n}
                depth={0}
                selectedPath={selectedPath}
                onSelect={onSelectFile}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-fg-subtle">비어 있음</div>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `방금 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(ms).toLocaleDateString("ko-KR");
}

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selectedPath === node.path;
  const isDir = node.type === "dir";

  return (
    <div>
      <button
        onClick={() => {
          if (isDir) setOpen((o) => !o);
          else onSelect(node.path);
        }}
        className={`group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
          isSelected
            ? "bg-navy/10 text-fg"
            : "text-fg-muted hover:bg-bg-sunken hover:text-fg"
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {isDir ? (
          <>
            <ChevronRight
              className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            />
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gold" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-gold" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
