"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  X,
  FolderOpen,
  LogOut,
  Trash2,
  Copy,
  Check,
  Github,
  Rocket,
  ExternalLink,
  Loader2,
  Sun,
  Moon,
  Monitor,
  Palette,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import { useTheme, type ThemePreference } from "@/lib/client/theme";

type Props = {
  open: boolean;
  onClose: () => void;
  workspace: string | null;
  /** Active project ID — Reset Workspace clears just this project. */
  projectId: string;
  email: string | null;
  image?: string | null;
  onWorkspaceReset: () => Promise<void>;
};

type SecretsState = {
  github: { connected: boolean; masked: string | null } | null;
  vercel: { connected: boolean; masked: string | null } | null;
};

export function SettingsModal({
  open,
  onClose,
  workspace,
  projectId,
  email,
  image,
  onWorkspaceReset,
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secrets, setSecrets] = useState<SecretsState | null>(null);

  const loadSecrets = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/secrets"));
      if (r.ok) setSecrets((await r.json()) as SecretsState);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setConfirmReset(false);
    loadSecrets();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, loadSecrets]);

  if (!open) return null;

  async function handleReset() {
    setResetting(true);
    try {
      const r = await fetch(
        apiUrl(`/api/workspace?projectId=${encodeURIComponent(projectId)}`),
        { method: "DELETE" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await onWorkspaceReset();
      setConfirmReset(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  async function handleSignOut() {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    await signOut({ callbackUrl: `${basePath}/` });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30 px-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold text-fg">계정 · 워크스페이스</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto px-5 py-5">
          {/* User */}
          <section className="flex items-center gap-3 rounded-xl border border-border bg-bg p-3">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-full"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-sunken text-sm font-semibold text-fg-muted">
                {email?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{email}</div>
              <div className="text-[11px] text-fg-subtle">덕수고등학교 계정으로 인증됨</div>
            </div>
          </section>

          {/* Theme */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Palette className="h-4 w-4 text-gold" />
              <h3 className="text-sm font-semibold text-fg">테마</h3>
            </div>
            <p className="mb-3 text-xs text-fg-muted">
              앱 전체 색상 테마를 선택하세요. <span className="font-medium text-fg">시스템</span>은
              운영체제의 라이트/다크 설정을 따라갑니다.
            </p>
            <ThemePicker />
          </section>

          {/* Active project workspace */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-gold" />
              <h3 className="text-sm font-semibold text-fg">활성 프로젝트 폴더</h3>
            </div>
            <p className="mb-3 text-xs text-fg-muted">
              현재 선택된 프로젝트의 디스크 경로입니다. 다른 기기에서 같은 계정으로
              로그인해도 <span className="font-semibold text-fg">같은 파일과 대화 이력</span>이 유지됩니다.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11px] text-fg-muted">
                {workspace || "—"}
              </code>
              {workspace && (
                <button
                  onClick={() => copy(workspace)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-fg-muted transition-colors hover:bg-bg-sunken"
                  title="경로 복사"
                  aria-label="경로 복사"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </section>

          {/* Integrations */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">통합 (Integrations)</h3>
            <p className="mb-3 text-xs text-fg-muted">
              토큰을 등록하면 채팅에서 자연어로 GitHub 푸시·Vercel 배포가 가능해집니다.
              토큰은 서버에 AES-256으로 암호화되어 저장됩니다.
            </p>
            <div className="space-y-2">
              <IntegrationCard
                kind="github"
                label="GitHub"
                Icon={Github}
                placeholder="ghp_xxxxxxxx 또는 github_pat_..."
                tokenHref="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Duksoo%20Code"
                state={secrets?.github ?? null}
                onChange={loadSecrets}
              />
              <IntegrationCard
                kind="vercel"
                label="Vercel"
                Icon={Rocket}
                placeholder="vercel_xxxxxxxx"
                tokenHref="https://vercel.com/account/tokens"
                state={secrets?.vercel ?? null}
                onChange={loadSecrets}
              />
            </div>
          </section>

          {/* Danger */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">위험 구역</h3>
            {confirmReset ? (
              <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft p-3">
                <p className="text-xs text-danger">
                  <strong>현재 프로젝트</strong> 안의 모든 파일과 대화 이력이 영구
                  삭제됩니다. 다른 프로젝트는 영향 없음. 계속하시겠어요?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="flex-1 rounded-lg bg-danger px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-danger-strong disabled:opacity-50"
                  >
                    {resetting ? "삭제 중…" : "삭제 확인"}
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-sunken"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg-muted transition-colors hover:border-danger/30 hover:bg-danger-soft hover:text-danger"
              >
                <span className="flex items-center gap-2">
                  <Trash2 className="h-3.5 w-3.5" />
                  활성 프로젝트 초기화
                </span>
                <span className="text-fg-subtle">파일 + 대화 전체 삭제</span>
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
            >
              <span className="flex items-center gap-2">
                <LogOut className="h-3.5 w-3.5" />
                로그아웃
              </span>
              <span className="text-fg-subtle">파일은 그대로 유지</span>
            </button>
          </section>
        </div>

        <div className="border-t border-border bg-bg-sunken px-5 py-3 text-[11px] text-fg-muted">
          Anthropic API 키는 서버에서 관리되며 외부로 전송되지 않습니다.
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  kind,
  label,
  Icon,
  placeholder,
  tokenHref,
  state,
  onChange,
}: {
  kind: "github" | "vercel";
  label: string;
  Icon: typeof Github;
  placeholder: string;
  tokenHref: string;
  state: { connected: boolean; masked: string | null } | null;
  onChange: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(apiUrl("/api/secrets"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, token: token.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setToken("");
      setEditing(false);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(apiUrl(`/api/secrets?kind=${kind}`), {
        method: "DELETE",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connected = state?.connected === true;

  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${
            connected ? "bg-success/10 text-success" : "bg-bg-sunken text-fg-muted"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">{label}</div>
          <div className="text-[11px] text-fg-subtle">
            {connected ? `연결됨 · ${state?.masked}` : "미연결"}
          </div>
        </div>
        {connected ? (
          <button
            onClick={disconnect}
            disabled={busy}
            className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-danger/30 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
          >
            연결 해제
          </button>
        ) : !editing ? (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md bg-navy px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-navy-soft"
          >
            연결
          </button>
        ) : null}
      </div>

      {editing && !connected && (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-border-strong"
          />
          <div className="flex items-center justify-between gap-2">
            <a
              href={tokenHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-gold-deep hover:underline"
            >
              토큰 발급 받기 <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setEditing(false);
                  setToken("");
                  setError(null);
                }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-fg-muted hover:bg-bg-sunken"
              >
                취소
              </button>
              <button
                onClick={save}
                disabled={busy || !token.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-navy px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-navy-soft disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                저장
              </button>
            </div>
          </div>
          {error && (
            <p className="text-[11px] text-danger">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ThemePicker() {
  const { pref, change } = useTheme()
  const options: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: '시스템', icon: Monitor },
    { id: 'light', label: '라이트', icon: Sun },
    { id: 'dark', label: '다크', icon: Moon },
  ]
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((o) => {
        const Icon = o.icon
        const selected = pref === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => change(o.id)}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors ${
              selected
                ? 'border-navy-soft bg-navy text-white'
                : 'border-border bg-bg text-fg-muted hover:border-border-strong hover:bg-bg-sunken hover:text-fg'
            }`}
            aria-pressed={selected}
          >
            <Icon className="h-4 w-4" />
            <span className="font-medium">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
