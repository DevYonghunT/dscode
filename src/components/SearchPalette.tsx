"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FileText, Folder, X, CornerDownLeft } from "lucide-react";
import { apiUrl } from "@/lib/client/url";

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onPickFile: (path: string) => void;
};

type Hit =
  | { kind: "name"; path: string; type: "dir" | "file" }
  | { kind: "content"; path: string; line: number; text: string };

type Response = {
  nameHits: Extract<Hit, { kind: "name" }>[];
  contentHits: Extract<Hit, { kind: "content" }>[];
};

const DEBOUNCE_MS = 200;

export function SearchPalette({ projectId, open, onClose, onPickFile }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setError(null);
      setActiveIdx(0);
      // Focus shortly after mount
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Debounced fetch
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setResults(null);
      return;
    }
    let abort = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ projectId, q: query.trim() });
        const r = await fetch(apiUrl(`/api/search?${qs.toString()}`));
        const j = await r.json();
        if (abort) return;
        if (!r.ok) {
          setError(j.error || `HTTP ${r.status}`);
          setResults(null);
          return;
        }
        setResults(j as Response);
        setActiveIdx(0);
      } catch (e) {
        if (!abort) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abort) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      abort = true;
      clearTimeout(t);
    };
  }, [query, projectId, open]);

  // Flatten name + content hits in a stable order for keyboard navigation.
  const flat: Hit[] = useMemo(() => {
    if (!results) return [];
    return [...results.nameHits, ...results.contentHits];
  }, [results]);

  function pick(hit: Hit) {
    if (hit.kind === "name") {
      if (hit.type === "file") {
        onPickFile(hit.path);
        onClose();
      }
    } else {
      onPickFile(hit.path);
      onClose();
    }
  }

  // Global Esc / Enter / arrows
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        if (flat[activeIdx]) {
          e.preventDefault();
          pick(flat[activeIdx]);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, activeIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy/30 px-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="파일 이름 또는 내용 검색…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          <kbd className="hidden rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-subtle sm:inline">
            Esc
          </kbd>
          <button
            onClick={onClose}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-sunken hover:text-fg sm:hidden"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 text-xs text-fg-subtle">검색 중…</div>
          )}
          {error && (
            <div className="m-3 rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {!loading && !error && query.trim() && results && flat.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-fg-subtle">
              결과 없음
            </div>
          )}

          {results && results.nameHits.length > 0 && (
            <ResultGroup title="파일 이름">
              {results.nameHits.map((h, i) => (
                <ResultRow
                  key={`n-${h.path}`}
                  active={activeIdx === i}
                  onClick={() => pick(h)}
                  onHover={() => setActiveIdx(i)}
                >
                  {h.type === "dir" ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-gold" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  )}
                  <span className="truncate font-mono text-xs">{h.path}</span>
                </ResultRow>
              ))}
            </ResultGroup>
          )}

          {results && results.contentHits.length > 0 && (
            <ResultGroup title="내용 검색">
              {results.contentHits.map((h, i) => {
                const idx = (results.nameHits.length || 0) + i;
                return (
                  <ResultRow
                    key={`c-${h.path}-${h.line}-${i}`}
                    active={activeIdx === idx}
                    onClick={() => pick(h)}
                    onHover={() => setActiveIdx(idx)}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs">{h.path}</span>
                        <span className="shrink-0 rounded bg-bg-sunken px-1 py-0.5 font-mono text-[10px] text-fg-subtle">
                          L{h.line}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-fg-muted">
                        {h.text}
                      </div>
                    </div>
                  </ResultRow>
                );
              })}
            </ResultGroup>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-bg-sunken px-3 py-2 text-[10px] text-fg-subtle">
          <span>↑↓ 이동 · ↵ 선택 · Esc 닫기</span>
          <span>현재 프로젝트 워크스페이스 내 검색</span>
        </div>
      </div>
    </div>
  );
}

function ResultGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-b border-border bg-bg-sunken px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  onHover,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-navy/5 text-fg" : "text-fg-muted hover:bg-bg-sunken"
      }`}
    >
      {children}
      {active && (
        <CornerDownLeft className="ml-auto h-3 w-3 shrink-0 text-fg-subtle" />
      )}
    </button>
  );
}
