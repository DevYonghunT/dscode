"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronDown,
  FolderGit2,
  Plus,
  Check,
  Trash2,
  Loader2,
  X,
  Download,
  Share2,
  Github,
  FolderInput,
  FolderPlus,
  Link2,
  FolderSearch,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import type { Project } from "@/lib/client/types";
import { ShareModal } from "./ShareModal";
import { FolderPickerModal, type FolderPickerMode } from "./FolderPickerModal";

type Props = {
  projects: Project[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreated: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
};

export function ProjectSwitcher({
  projects,
  activeId,
  onSelect,
  onCreated,
  onDeleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = projects.find((p) => p.id === activeId) || projects[0];

  return (
    <>
      <div className="relative" ref={wrapRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm transition-colors hover:border-border-strong hover:bg-bg-sunken"
          title="프로젝트 전환"
        >
          <FolderGit2 className="h-3.5 w-3.5 text-gold" />
          <span className="max-w-[200px] truncate text-xs font-medium text-navy">
            {active?.name || "프로젝트"}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-fg-subtle transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {open && (
          <div className="absolute right-0 z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg">
            <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              내 프로젝트
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {projects.map((p) => (
                <li key={p.id}>
                  <ProjectRow
                    project={p}
                    active={p.id === activeId}
                    onSelect={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                    onDeleted={onDeleted}
                  />
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                setCreating(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-xs font-medium text-navy transition-colors hover:bg-bg-sunken"
            >
              <Plus className="h-3.5 w-3.5" />
              새 프로젝트 추가
            </button>
          </div>
        )}
      </div>

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await onCreated();
          }}
        />
      )}
    </>
  );
}

function ProjectRow({
  project,
  active,
  onSelect,
  onDeleted,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isDefault = project.id === "default";

  async function del() {
    setBusy(true);
    try {
      const r = await fetch(
        apiUrl(`/api/projects?id=${encodeURIComponent(project.id)}`),
        { method: "DELETE" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error || `HTTP ${r.status}`);
        return;
      }
      await onDeleted();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1 ${active ? "bg-navy/5" : ""}`}
    >
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-bg-sunken"
      >
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
          className={`truncate ${active ? "font-medium text-navy" : "text-fg-muted"}`}
        >
          {project.name}
        </span>
        {project.external && (
          <span
            className="shrink-0 rounded bg-gold-soft px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold-deep"
            title={project.root}
          >
            외부
          </span>
        )}
        {active && <Check className="ml-auto h-3 w-3 shrink-0 text-gold" />}
      </button>
      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            onClick={del}
            disabled={busy}
            className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "…" : "삭제"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-sunken"
          >
            취소
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShareOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-gold-deep"
            title="공유 링크"
            aria-label="공유 링크"
          >
            <Share2 className="h-3 w-3" />
          </button>
          <a
            href={apiUrl(
              `/api/projects/${encodeURIComponent(project.id)}/export`,
            )}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-navy"
            title="zip 다운로드"
            aria-label="zip 다운로드"
          >
            <Download className="h-3 w-3" />
          </a>
          {!isDefault && (
            <button
              onClick={() => setConfirming(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-red-50 hover:text-danger"
              title="프로젝트 삭제"
              aria-label="프로젝트 삭제"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      )}
      {shareOpen && (
        <ShareModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

type SourceMode = "empty" | "git" | "external";

/** Slugify the user-typed name into something safe for a folder name. */
function nameToSlug(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/[\s\/\\:*?"<>|]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const DEFAULT_PARENT = "~/dscode-projects";

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<SourceMode>("empty");
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-suggest a folder path from the name *unless* the user has manually
  // touched the path input or chose "external" (where they must pick it).
  function updateName(v: string) {
    setName(v);
    if (!pathEdited && mode !== "external") {
      const slug = nameToSlug(v);
      setFolderPath(slug ? `${DEFAULT_PARENT}/${slug}` : "");
    }
  }

  function changeMode(next: SourceMode) {
    setMode(next);
    setError(null);
    // Reset auto-suggestion when switching to "external" (must be user-picked).
    if (next === "external" && !pathEdited) setFolderPath("");
    if (next !== "external" && !pathEdited && name.trim()) {
      setFolderPath(`${DEFAULT_PARENT}/${nameToSlug(name)}`);
    }
  }

  // Fill folder name into the name field if user filled path/git first.
  function maybeSuggestName(value: string) {
    if (name.trim()) return;
    const seg = value
      .trim()
      .replace(/\/$/, "")
      .split(/[\/:]/)
      .filter(Boolean)
      .pop();
    if (seg) setName(seg.replace(/\.git$/, ""));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    if (!folderPath.trim()) {
      setError("작업할 폴더 경로를 입력하세요.");
      return;
    }
    if (mode === "git" && !gitUrl.trim()) {
      setError("GitHub URL을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(apiUrl("/api/projects"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          path: folderPath.trim(),
          gitUrl: mode === "git" ? gitUrl.trim() : undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const pathHint =
    mode === "external"
      ? "이미 존재하는 폴더의 절대 경로를 입력하세요."
      : mode === "git"
        ? "비어있어야 합니다. 없으면 자동 생성. git clone이 여기에 파일을 채웁니다."
        : "비어있어야 합니다. 없으면 자동 생성됩니다.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30 px-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold text-navy">
            새 프로젝트
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-sunken"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          {/* Source mode */}
          <div>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              시작 방식
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <ModeOption
                Icon={FolderPlus}
                label="빈 폴더"
                hint="새로 만들기"
                selected={mode === "empty"}
                onSelect={() => changeMode("empty")}
              />
              <ModeOption
                Icon={Github}
                label="GitHub"
                hint="레포 clone"
                selected={mode === "git"}
                onSelect={() => changeMode("git")}
              />
              <ModeOption
                Icon={FolderInput}
                label="기존 폴더"
                hint="내 컴퓨터 연결"
                selected={mode === "external"}
                onSelect={() => changeMode("external")}
              />
            </div>
          </div>

          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              프로젝트 이름
            </span>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => updateName(e.target.value)}
              maxLength={60}
              placeholder="예: 학교 과제 - HTML 게임"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-border-strong"
            />
          </label>

          {/* GitHub URL (only in git mode) */}
          {mode === "git" && (
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                GitHub URL
              </span>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => {
                  setGitUrl(e.target.value);
                  maybeSuggestName(e.target.value);
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder="owner/repo · https://github.com/owner/repo · git@github.com:..."
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-border-strong"
              />
              <span className="mt-1 block text-[10px] text-fg-subtle">
                Private 레포는 설정에서 GitHub PAT를 먼저 연결해두세요.
              </span>
            </label>
          )}

          {/* Folder path — ALWAYS shown, required */}
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              <span>
                작업할 폴더 경로 <span className="text-danger/80">*</span>
              </span>
              {mode !== "external" && (
                <button
                  type="button"
                  onClick={() => {
                    if (!name.trim()) return;
                    setPathEdited(false);
                    setFolderPath(`${DEFAULT_PARENT}/${nameToSlug(name)}`);
                  }}
                  className="text-[10px] font-normal normal-case tracking-normal text-gold-deep hover:underline"
                >
                  기본 경로로
                </button>
              )}
            </span>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => {
                  setFolderPath(e.target.value);
                  setPathEdited(true);
                  if (mode === "external") maybeSuggestName(e.target.value);
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  mode === "external"
                    ? "/Users/me/Documents/MyApp 또는 ~/Development/MyApp"
                    : "~/dscode-projects/my-app"
                }
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-border-strong"
              />
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-sunken hover:text-navy"
                title="폴더 선택기 열기"
              >
                <FolderSearch className="h-3.5 w-3.5" />
                찾아보기
              </button>
            </div>
            <span className="mt-1 flex items-start gap-1 text-[10px] text-fg-subtle">
              <Link2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span>{pathHint}</span>
            </span>
          </label>

          {error && (
            <div className="whitespace-pre-line rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-bg-sunken px-5 py-3">
          <p className="text-[10px] text-fg-subtle">
            모든 작업은 위에서 지정한 폴더에서 진행됩니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-sunken"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !folderPath.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-soft disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {mode === "git" ? "Clone & 만들기" : mode === "external" ? "연결하기" : "만들기"}
            </button>
          </div>
        </div>
      </form>

      {pickerOpen && (
        <FolderPickerModal
          mode={(mode === "external" ? "existing" : "empty-or-create") as FolderPickerMode}
          initialPath={folderPath.trim() || undefined}
          onClose={() => setPickerOpen(false)}
          onPick={(picked) => {
            setFolderPath(picked);
            setPathEdited(true);
            setPickerOpen(false);
            if (mode === "external") maybeSuggestName(picked);
          }}
        />
      )}
    </div>
  );
}

function ModeOption({
  Icon,
  label,
  hint,
  selected,
  onSelect,
}: {
  Icon: typeof FolderPlus;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-all ${
        selected
          ? "border-navy bg-navy/5 text-navy shadow-sm"
          : "border-border bg-bg text-fg-muted hover:border-border-strong hover:bg-bg-sunken"
      }`}
    >
      <Icon className={`h-4 w-4 ${selected ? "text-gold" : "text-fg-subtle"}`} />
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-fg-subtle">{hint}</span>
    </button>
  );
}
