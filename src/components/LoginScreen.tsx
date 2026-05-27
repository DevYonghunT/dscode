"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Emblem } from "./Emblem";

// Friendly Korean copy for the NextAuth `?error=` codes the user can land on.
// NextAuth wraps most provider errors into "Configuration", so we mention the
// most likely culprit (redirect_uri_mismatch) right in that message.
const ERROR_COPY: Record<string, string> = {
  Configuration:
    "Google OAuth 설정에 문제가 있습니다.\n자주 발생하는 원인:\n1) Google Cloud Console의 OAuth client에 Authorized redirect URI로 정확히 다음 값이 등록돼 있는지 확인하세요:\nhttp://localhost:3000/dscode/api/auth/callback/google\n2) .env.local의 AUTH_GOOGLE_ID/SECRET이 진짜 값인지, 서버를 재시작했는지 확인하세요.",
  AccessDenied:
    "이 계정으로는 접속할 수 없습니다. @duksoo.hs.kr 학교 계정으로만 로그인할 수 있어요.",
  Verification: "이메일 인증에 실패했습니다. 다시 시도해주세요.",
  OAuthSignin: "Google 로그인 시작 중 오류가 발생했습니다.",
  OAuthCallback: "Google 인증 응답 처리 중 오류가 발생했습니다.",
  OAuthCreateAccount: "계정 생성 중 오류가 발생했습니다.",
  EmailCreateAccount: "계정 생성 중 오류가 발생했습니다.",
  Callback: "콜백 처리 중 오류가 발생했습니다.",
  Default: "로그인에 실패했습니다.",
};

export function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up `?error=...` left by NextAuth's redirect after a failed sign-in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) {
      setError(ERROR_COPY[code] || `${ERROR_COPY.Default} (${code})`);
      // Clean the URL so the message can be dismissed by retrying.
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("code");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
      await signIn("google", { callbackUrl: `${basePath}/` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated p-2 shadow-md ring-1 ring-border">
            <Emblem size={56} className="h-14 w-14" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-navy">
              Duksoo Code
            </h1>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              DS Code · 덕수고등학교 코딩 에이전트
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-bg-elevated p-6 shadow-sm">
          <p className="mb-4 text-center text-sm text-fg-muted">
            <span className="font-semibold text-navy">@duksoo.hs.kr</span> 학교 계정으로만
            <br />
            접속할 수 있습니다.
          </p>

          <button
            onClick={go}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-white text-sm font-medium text-fg shadow-sm transition-all hover:border-border-strong hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />
            ) : (
              <GoogleMark />
            )}
            {busy ? "이동 중…" : "Google 계정으로 로그인"}
          </button>

          {error && (
            <div className="mt-3 whitespace-pre-line rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs leading-relaxed text-danger">
              {error}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-fg-subtle">
          로그인하면 이메일에 묶인 영구 작업 공간이 자동으로 만들어집니다.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
