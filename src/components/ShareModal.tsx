"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Share2, Copy, Check, Trash2, Loader2, Eye } from "lucide-react";
import { apiUrl } from "@/lib/client/url";

type ShareRecord = {
  token: string;
  email: string;
  projectId: string;
  createdAt: number;
};

type Props = {
  projectId: string;
  projectName: string;
  onClose: () => void;
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

function shareUrlFor(token: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${BASE}/share/${token}`;
}

export function ShareModal({ projectId, projectName, onClose }: Props) {
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(projectId)}/shares`),
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { shares: ShareRecord[] };
      setShares(j.shares);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  async function createShare() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        apiUrl(`/api/projects/${encodeURIComponent(projectId)}/shares`),
        { method: "POST" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    if (!confirm("이 공유 링크를 해제하시겠습니까?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        apiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/shares?token=${encodeURIComponent(token)}`,
        ),
        { method: "DELETE" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function copy(token: string) {
    navigator.clipboard.writeText(shareUrlFor(token)).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1200);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-gold" />
            <h2 className="font-display text-base font-semibold text-fg">
              공유 — {projectName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-sunken"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-border bg-bg p-3 text-xs text-fg-muted">
            <p className="font-medium text-fg">
              <Eye className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
              읽기 전용 링크
            </p>
            <p className="mt-1 leading-relaxed">
              링크가 있는 누구든 이 프로젝트의 파일을 <strong>볼 수만</strong> 있습니다.
              편집·실행·다운로드는 불가. 링크는 언제든 해제할 수 있어요.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {shares === null ? (
            <div className="px-1 text-xs text-fg-subtle">불러오는 중…</div>
          ) : shares.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-fg-subtle">
              아직 공유 링크가 없습니다.
            </div>
          ) : (
            <ul className="space-y-2">
              {shares.map((s) => {
                const url = shareUrlFor(s.token);
                const copied = copiedToken === s.token;
                return (
                  <li
                    key={s.token}
                    className="rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-[11px] text-fg-muted outline-none"
                      />
                      <button
                        onClick={() => copy(s.token)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-border text-fg-muted hover:bg-bg-sunken"
                        title="URL 복사"
                        aria-label="URL 복사"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => revoke(s.token)}
                        disabled={busy}
                        className="flex h-7 w-7 items-center justify-center rounded border border-border text-fg-muted transition-colors hover:border-danger/30 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                        title="공유 해제"
                        aria-label="공유 해제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-fg-subtle">
                      {new Date(s.createdAt).toLocaleString("ko-KR")} 발급
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-bg-sunken px-5 py-3">
          <p className="text-[11px] text-fg-subtle">
            공유한 시점 이후의 변경도 링크 방문자에게 실시간 반영됩니다.
          </p>
          <button
            onClick={createShare}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-navy-soft disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            새 링크 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
