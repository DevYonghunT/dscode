"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Save, RotateCw, X, AlertTriangle, Check } from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import { CodeEditor } from "./CodeEditor";

type Props = {
  path: string | null;
  /** Active project the file lives in. Re-fetches when this changes. */
  projectId: string;
  /** Increments whenever the agent finishes a turn so we can poll for changes. */
  reloadNonce?: number;
  onClose: () => void;
};

type FileData = {
  path: string;
  size: number;
  mtimeMs: number;
  truncated: boolean;
  content: string;
};

export function FileViewer({ path, projectId, reloadNonce, onClose }: Props) {
  const [data, setData] = useState<FileData | null>(null);
  const [editing, setEditing] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const dirtyRef = useRef(false);

  // Load (and reload on path / reloadNonce changes).
  useEffect(() => {
    if (!path) {
      setData(null);
      setEditing("");
      setError(null);
      setExternalChange(false);
      dirtyRef.current = false;
      return;
    }
    let abort = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ path, projectId });
    fetch(apiUrl(`/api/file?${qs.toString()}`))
      .then(async (r) => {
        const j = await r.json();
        if (abort) return;
        if (!r.ok) {
          setError(j.error || "파일을 불러올 수 없습니다.");
          setData(null);
          return;
        }
        // 편집 중(dirty)이면 mtime 변화 여부와 무관하게 편집 내용을 보존한다.
        // (mtime이 같아도 setData/setEditing으로 덮으면 미저장 입력이 사라짐)
        if (dirtyRef.current) {
          if (data && j.mtimeMs > data.mtimeMs + 1) setExternalChange(true);
          return;
        }
        setData(j);
        setEditing(j.content);
        setExternalChange(false);
        dirtyRef.current = false;
      })
      .catch((e) => !abort && setError(e.message))
      .finally(() => !abort && setLoading(false));
    return () => {
      abort = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, projectId, reloadNonce]);

  const dirty = data ? editing !== data.content : false;
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  async function save() {
    if (!data || !path || !dirty || saving) return;
    // 일부만 로드된(truncated) 파일은 저장 금지 — 잘린 내용으로 원본을 덮어쓰면 안 됨.
    if (data.truncated) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/file"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          projectId,
          content: editing,
          mtimeMs: data.mtimeMs,
          truncated: data.truncated,
        }),
      });
      const j = await res.json();
      if (res.status === 409) {
        setExternalChange(true);
        return;
      }
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData({ ...data, mtimeMs: j.mtimeMs, size: j.size, content: editing });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function discardAndReload() {
    if (!path) return;
    dirtyRef.current = false;
    setData(null);
    setEditing("");
    setExternalChange(false);
    setLoading(true);
    const qs = new URLSearchParams({ path, projectId });
    fetch(apiUrl(`/api/file?${qs.toString()}`))
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "파일을 불러올 수 없습니다.");
        setData(j);
        setEditing(j.content);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  // Cmd/Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (!path || !dirty) return;
        e.preventDefault();
        // truncated 파일은 저장 차단 (일부만 로드된 상태라 원본 손상 위험)
        if (data?.truncated) return;
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, dirty, editing, data]);

  if (!path) {
    return (
      <aside className="flex h-full flex-col items-center justify-center border-l border-border bg-bg-elevated px-6 text-center">
        <FileText className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
        <p className="mt-3 text-sm text-fg-subtle">
          파일을 선택하면
          <br />
          여기서 보고 편집할 수 있습니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col border-l border-border bg-bg-elevated">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate font-mono text-xs text-fg-muted">{path}</span>
          {dirty && (
            <span className="shrink-0 rounded-full bg-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-gold-deep">
              수정됨
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={save}
            disabled={!dirty || saving || !!data?.truncated}
            className={`flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
              dirty && !data?.truncated
                ? "bg-navy text-white hover:bg-navy-soft disabled:opacity-50"
                : "text-fg-subtle"
            }`}
            title={
              data?.truncated
                ? "파일이 너무 커서 저장할 수 없습니다"
                : "저장 (Cmd/Ctrl+S)"
            }
          >
            {savedFlash ? (
              <>
                <Check className="h-3 w-3" /> 저장됨
              </>
            ) : (
              <>
                <Save className="h-3 w-3" /> 저장
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-fg"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {externalChange && (
        <div className="flex items-start gap-2 border-b border-gold/40 bg-gold-soft/50 px-3 py-2 text-xs text-gold-deep">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <p>외부에서 파일이 변경되었습니다 (에이전트 작업으로 추정).</p>
            <button
              onClick={discardAndReload}
              className="mt-1 inline-flex items-center gap-1 rounded bg-gold-deep px-2 py-0.5 text-white hover:bg-gold-strong"
            >
              <RotateCw className="h-3 w-3" /> 변경 사항 버리고 새로고침
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden bg-bg">
        {loading && !data ? (
          <div className="px-4 py-3 text-xs text-fg-subtle">불러오는 중…</div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : data ? (
          <CodeEditor
            path={path}
            value={editing}
            onChange={setEditing}
          />
        ) : null}
      </div>

      {data?.truncated && (
        <div className="flex items-start gap-2 border-t border-gold/40 bg-gold-soft/40 px-4 py-2 text-xs text-gold-deep">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            파일이 너무 커서 처음 512KB만 표시됩니다. 안전을 위해 저장할 수 없어요.
          </p>
        </div>
      )}
    </aside>
  );
}
