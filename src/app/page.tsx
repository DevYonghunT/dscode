"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { SessionTree } from "@/components/SessionTree";
import { FileViewer } from "@/components/FileViewer";
import { Chat } from "@/components/Chat";
import { SettingsModal } from "@/components/SettingsModal";
import { LoginScreen } from "@/components/LoginScreen";
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

const DEFAULT_PROJECT_ID = "default";
const ACTIVE_PROJECT_LS_KEY = "dscode_active_project";
const MODEL_LS_KEY = "dscode_model";

export default function Home() {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [user, setUser] = useState<MeUser | null>(null);
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
