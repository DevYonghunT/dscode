"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  ArrowUp,
  Home,
  Plus,
  Loader2,
  X,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";

export type FolderPickerMode = "empty-or-create" | "existing";

type Entry = {
  name: string;
  path: string;
  isEmpty: boolean;
  hidden: boolean;
};

type Shortcut = { label: string; path: string };

type BrowseResponse = {
  path: string;
  parent: string | null;
  entries: Entry[];
  shortcuts: Shortcut[];
};

type Props = {
  /**
   * - "empty-or-create" → user should land on an empty folder (빈 폴더/GitHub clone 모드).
   *   Empty folders are highlighted; "Create folder here" is prominent.
   * - "existing" → user picks any folder (기존 폴더 모드). Empty is fine too.
   */
  mode: FolderPickerMode;
  /** Initial path to start browsing from. Defaults to home. */
  initialPath?: string;
  onClose: () => void;
  onPick: (absPath: string) => void;
};

/**
 * In-browser folder picker. Browses the SERVER's filesystem (since the agent
 * runs there). Doesn't have native Finder, but gives a clickable folder tree
 * with breadcrumbs and a "create here" action.
 */
export function FolderPickerModal({
  mode,
  initialPath,
  onClose,
  onPick,
}: Props) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (atPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = atPath ? `?path=${encodeURIComponent(atPath)}` : "";
      const r = await fetch(apiUrl(`/api/fs/browse${qs}`));
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j as BrowseResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — try the requested path, fall back to home if it errors.
  useEffect(() => {
    load(initialPath);
  }, [initialPath, load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function createHere() {
    if (!data || !newFolderName.trim() || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const r = await fetch(apiUrl("/api/fs/mkdir"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent: data.path, name: newFolderName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // Auto-pick the freshly created folder; it's the most common intent.
      onPick(j.path as string);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  }

  const breadcrumb = data ? splitBreadcrumb(data.path) : [];
  const visibleEntries = data
    ? showHidden
      ? data.entries
      : data.entries.filter((e) => !e.hidden)
    : [];

  const canPickCurrent =
    data &&
    (mode === "existing" ||
      // for empty-or-create: only allow picking if THIS folder is empty
      data.entries.length === 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={wrapRef}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-navy">
            폴더 선택
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-sunken"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Shortcuts */}
        {data && data.shortcuts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-sunken px-3 py-2">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              빠른 이동
            </span>
            {data.shortcuts.map((s) => (
              <button
                key={s.path}
                type="button"
                onClick={() => load(s.path)}
                className="inline-flex items-center gap-1 rounded border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:text-navy"
                title={s.path}
              >
                {s.label === "홈" && <Home className="h-2.5 w-2.5" />}
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => data?.parent && load(data.parent)}
            disabled={!data?.parent}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-sunken hover:text-navy disabled:cursor-not-allowed disabled:opacity-30"
            title="상위 폴더"
            aria-label="상위 폴더"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          {breadcrumb.map((seg, i) => (
            <span key={seg.path} className="flex shrink-0 items-center">
              {i > 0 && (
                <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-fg-subtle" />
              )}
              <button
                type="button"
                onClick={() => load(seg.path)}
                className="rounded px-1 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-bg-sunken hover:text-navy"
              >
                {seg.label}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto">
          {loading && !data && (
            <div className="flex items-center justify-center py-8 text-xs text-fg-subtle">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 불러오는 중…
            </div>
          )}
          {error && (
            <div className="m-3 rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {data && (
            <>
              {visibleEntries.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-fg-subtle">
                  {data.entries.length === 0
                    ? "이 폴더는 비어 있습니다."
                    : "하위 폴더 없음 (숨김 폴더만 있음)"}
                </div>
              ) : (
                <ul className="py-1">
                  {visibleEntries.map((e) => (
                    <li key={e.path}>
                      <button
                        type="button"
                        onClick={() => load(e.path)}
                        onDoubleClick={() => load(e.path)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-bg-sunken"
                      >
                        {e.hidden ? (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle/60" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-gold" />
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate ${e.hidden ? "text-fg-subtle" : "text-fg"}`}
                        >
                          {e.name}
                        </span>
                        {mode === "empty-or-create" && !e.isEmpty && (
                          <span className="shrink-0 rounded bg-bg-sunken px-1.5 py-0.5 text-[10px] text-fg-subtle">
                            내용 있음
                          </span>
                        )}
                        {e.isEmpty && (
                          <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                            비어있음
                          </span>
                        )}
                        <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Create folder section */}
        {data && (
          <div className="border-t border-border bg-bg-sunken px-3 py-2">
            {!creating ? (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setNewFolderName("");
                  setCreateError(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg hover:text-navy"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>여기에 새 폴더 만들기</span>
                <span className="ml-auto truncate font-mono text-[10px] text-fg-subtle">
                  {data.path}
                </span>
              </button>
            ) : (
              <div className="space-y-2 px-1 py-1">
                <input
                  autoFocus
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createHere();
                    }
                  }}
                  placeholder="새 폴더 이름"
                  className="w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs outline-none focus:border-border-strong"
                />
                {createError && (
                  <p className="text-[10px] text-danger">{createError}</p>
                )}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={createHere}
                    disabled={createBusy || !newFolderName.trim()}
                    className="inline-flex items-center gap-1 rounded bg-navy px-2 py-1 text-[11px] font-medium text-white hover:bg-navy-soft disabled:opacity-50"
                  >
                    {createBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                    만들고 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:bg-bg-sunken"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-bg-elevated px-3 py-2.5">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-subtle hover:bg-bg-sunken"
            title="숨김 폴더 보기/감추기"
          >
            {showHidden ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            <span>{showHidden ? "숨김 폴더 숨기기" : "숨김 폴더 보기"}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-[11px] text-fg-subtle sm:inline">
              {mode === "empty-or-create" && data && data.entries.length > 0
                ? "비어있는 폴더를 선택하거나 새로 만드세요."
                : null}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted hover:bg-bg-sunken"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => data && onPick(data.path)}
              disabled={!canPickCurrent}
              className="inline-flex items-center gap-1 rounded bg-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
              title={
                canPickCurrent
                  ? `이 폴더 선택: ${data?.path}`
                  : "비어있는 폴더만 선택할 수 있습니다 (또는 새로 만들기)"
              }
            >
              <Check className="h-3.5 w-3.5" />
              <span>이 폴더 선택</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function splitBreadcrumb(absPath: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  const parts = absPath.split("/").filter(Boolean);
  let acc = "";
  out.push({ label: "/", path: "/" });
  for (const p of parts) {
    acc += `/${p}`;
    out.push({ label: p, path: acc });
  }
  return out;
}

