"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { SessionTree } from "@/components/SessionTree";
import { FileViewer } from "@/components/FileViewer";
import { Chat } from "@/components/Chat";
import { SettingsModal } from "@/components/SettingsModal";
import { LoginScreen } from "@/components/LoginScreen";
import { ApprovalScreen, type ApprovalState } from "@/components/ApprovalScreen";
import { SearchPalette } from "@/components/SearchPalette";
import { ResizableLayout } from "@/components/ResizableLayout";
import { useChat } from "@/hooks/useChat";
import { apiUrl } from "@/lib/client/url";
import type { ChatTurn, Project } from "@/lib/client/types";
import {
  DEFAULT_MODEL,
  isModelId,
  type ModelId,
} from "@/lib/client/models";

type MeUser = {
  email: string;
  name?: string | null;
  image?: string | null;
};

// Electron preload (electron/preload.cjs) 가 노출하는 브릿지. 웹(브라우저)에서는
// 없으므로 optional. persistToken 은 발급된 dsk_ 토큰을 OS 보안저장소에 저장한다.
declare global {
  interface Window {
    dscode?: {
      persistToken?: (token: string) => Promise<boolean>;
    };
  }
}

/** issue-token 응답에서 active 면 채팅 가능, 그 외는 상태 화면. */
type ApprovalUi = "active" | ApprovalState;

const DEFAULT_PROJECT_ID = "default";
const ACTIVE_PROJECT_LS_KEY = "dscode_active_project";
const MODEL_LS_KEY = "dscode_model";

export default function Home() {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<MeUser | null>(null);
  // 로그인 후 승인/토큰 발급 상태. null = 아직 미확인(로딩 직후).
  const [approval, setApproval] = useState<ApprovalUi | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileReloadNonce, setFileReloadNonce] = useState(0);
  const [sessionsReloadNonce, setSessionsReloadNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);

  const {
    turns,
    busy,
    send,
    stop,
    reset: resetChat,
    startNewSession,
    loadTurns,
    currentSessionId,
  } = useChat({ projectId: activeProjectId, model });

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0] || null;
  const activeWorkspace = activeProject?.root || null;

  // ── Bootstrap ────────────────────────────────────────────────────────────
  const loadMe = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/me"));
      const j = await r.json();
      if (j.user) setUser(j.user);
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setBootstrapped(true);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // ── 승인 확인 + 토큰 자동 발급 ──────────────────────────────────────────────
  // 로그인(세션) 성공 후, 앱(서버) 가 세션의 Google id_token 으로 agentclass 에
  // 승인 확인 + dsk_ 토큰 발급을 요청한다. 학생은 토큰을 직접 입력하지 않는다.
  //   active       → 토큰을 OS 보안저장소에 저장(다음 실행 대비). 현재 세션 채팅은
  //                  issue-token 라우트가 Next 프로세스 env 를 이미 갱신해 즉시 가능.
  //   pending/blocked/api_disabled → 상태 화면 표시(채팅 비활성)
  //   no_session/network 등 → error 상태(재시도 버튼)
  const issueToken = useCallback(async () => {
    setApproval("checking");
    try {
      const r = await fetch(apiUrl("/api/issue-token"), { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        token?: string | null;
      };
      const status = j?.status;
      if (status === "active" && typeof j.token === "string" && j.token) {
        // OS 보안저장소에 저장(데스크톱 앱일 때만). 실패해도 현재 세션은 동작하므로 무시.
        try {
          await window.dscode?.persistToken?.(j.token);
        } catch {
          /* 저장 실패: 다음 실행 때 다시 발급됨 */
        }
        setApproval("active");
      } else if (
        status === "pending" ||
        status === "blocked" ||
        status === "api_disabled"
      ) {
        setApproval(status);
      } else {
        // no_session / network_error / error / 알 수 없음 → 재시도 가능한 오류
        setApproval("error");
      }
    } catch {
      setApproval("error");
    }
  }, []);

  // user 가 확정되면 토큰 발급을 시도. user 가 없어지면(로그아웃) 상태 초기화.
  useEffect(() => {
    if (user) {
      issueToken();
    } else {
      setApproval(null);
    }
  }, [user, issueToken]);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    try {
      const r = await fetch(apiUrl("/api/projects"));
      if (!r.ok) return;
      const j = (await r.json()) as { projects: Project[] };
      setProjects(j.projects);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  useEffect(() => {
    if (!user || projects.length === 0) return;
    try {
      const stored = localStorage.getItem(ACTIVE_PROJECT_LS_KEY);
      if (stored && projects.some((p) => p.id === stored)) {
        setActiveProjectId(stored);
      } else {
        setActiveProjectId(projects[0]?.id || DEFAULT_PROJECT_ID);
      }
    } catch {
      /* ignore */
    }
  }, [user, projects]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_PROJECT_LS_KEY, activeProjectId);
    } catch {
      /* ignore */
    }
  }, [activeProjectId]);

  // Restore the saved model once on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_LS_KEY);
      if (saved && isModelId(saved)) setModel(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function changeModel(next: ModelId) {
    setModel(next);
    try {
      localStorage.setItem(MODEL_LS_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!busy && user && turns.length > 0) {
      const t = setTimeout(() => {
        setFileReloadNonce((n) => n + 1);
        setSessionsReloadNonce((n) => n + 1);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [busy, user, turns.length]);

  // ── Project / session transitions ────────────────────────────────────────
  function selectProject(id: string) {
    if (id === activeProjectId) return;
    setActiveProjectId(id);
    setSelectedFile(null);
    resetChat();
  }

  function newSessionFor(projectId: string) {
    if (projectId !== activeProjectId) {
      setActiveProjectId(projectId);
      setSelectedFile(null);
    }
    resetChat();
    startNewSession();
  }

  async function selectSession(projectId: string, sessionId: string) {
    if (projectId !== activeProjectId) {
      setActiveProjectId(projectId);
      setSelectedFile(null);
    }
    resetChat();
    // Fetch the past turns and paint them into the chat panel. The hook also
    // pins the session ID so the user's next message resumes the same thread.
    try {
      const r = await fetch(
        apiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
        ),
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { sessionId: string; turns: ChatTurn[] };
      loadTurns(j.turns || [], j.sessionId);
    } catch (e) {
      console.error("[session] load failed:", e);
    }
  }

  async function onProjectsChanged() {
    await loadProjects();
  }

  async function handleWorkspaceReset() {
    setSelectedFile(null);
    resetChat();
    setSessionsReloadNonce((n) => n + 1);
  }

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-fg-subtle animate-pulse-soft">불러오는 중…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  // 로그인은 됐지만 아직 승인/발급 전이면 상태 화면. active 일 때만 채팅 UI 노출.
  if (approval !== "active") {
    return (
      <ApprovalScreen
        state={approval ?? "checking"}
        onRetry={
          approval === "error" ||
          approval === "pending" ||
          approval === "api_disabled"
            ? issueToken
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      <Header
        user={user}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onProjectsChanged={onProjectsChanged}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <div className="flex-1 min-h-0">
        <ResizableLayout
          left={
            <SessionTree
              projects={projects}
              activeProjectId={activeProjectId}
              activeSessionId={currentSessionId}
              reloadNonce={sessionsReloadNonce}
              onSelectProject={selectProject}
              onSelectSession={selectSession}
              onNewSession={newSessionFor}
              onRefresh={() => setSessionsReloadNonce((n) => n + 1)}
            />
          }
          center={
            <Chat
              turns={turns}
              busy={busy}
              disabled={false}
              onSend={send}
              onStop={stop}
              onFilePathClick={setSelectedFile}
              model={model}
              onChangeModel={changeModel}
            />
          }
          right={
            <FileViewer
              path={selectedFile}
              projectId={activeProjectId}
              reloadNonce={fileReloadNonce}
              onClose={() => setSelectedFile(null)}
            />
          }
        />
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        workspace={activeWorkspace}
        projectId={activeProjectId}
        email={user.email}
        image={user.image}
        onWorkspaceReset={handleWorkspaceReset}
      />
      <SearchPalette
        projectId={activeProjectId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPickFile={setSelectedFile}
      />
    </div>
  );
}
