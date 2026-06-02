"use client";

import { Loader2, Clock, ShieldX, PauseCircle, RefreshCw } from "lucide-react";
import { Emblem } from "./Emblem";

/** 로그인은 됐지만 아직 채팅을 쓸 수 없는 승인 상태들. */
export type ApprovalState =
  | "checking" // issue-token 호출 중
  | "pending" // 선생님 승인 대기
  | "blocked" // 사용 제한
  | "api_disabled" // API 일시 중지
  | "error"; // 네트워크/세션 등 일시적 오류 (재시도 가능)

type Copy = {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "neutral" | "warn" | "danger";
};

const COPY: Record<Exclude<ApprovalState, "checking">, Copy> = {
  pending: {
    icon: <Clock className="h-6 w-6 text-gold" aria-hidden="true" />,
    title: "선생님 승인을 기다려주세요",
    body: "로그인은 완료됐어요. 선생님이 사용을 승인하면 바로 채팅을 시작할 수 있습니다.",
    tone: "neutral",
  },
  blocked: {
    icon: <ShieldX className="h-6 w-6 text-danger" aria-hidden="true" />,
    title: "사용이 제한되었습니다",
    body: "이 계정은 현재 DS Code 사용이 제한된 상태예요. 자세한 내용은 선생님께 문의해주세요.",
    tone: "danger",
  },
  api_disabled: {
    icon: <PauseCircle className="h-6 w-6 text-gold" aria-hidden="true" />,
    title: "사용이 일시 중지됐어요",
    body: "지금은 AI 사용이 잠시 중지된 상태입니다. 잠시 후 다시 시도하거나 선생님께 문의해주세요.",
    tone: "warn",
  },
  error: {
    icon: <RefreshCw className="h-6 w-6 text-fg-muted" aria-hidden="true" />,
    title: "승인 상태를 확인하지 못했어요",
    body: "네트워크 문제로 승인 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.",
    tone: "neutral",
  },
};

export function ApprovalScreen({
  state,
  onRetry,
}: {
  state: ApprovalState;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated p-2 shadow-md ring-1 ring-border">
            <Emblem size={56} className="h-14 w-14" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">
              Duksoo Code
            </h1>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              DS Code · 덕수고등학교 코딩 에이전트
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-bg-elevated p-6 shadow-sm">
          {state === "checking" ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-fg-muted" aria-hidden="true" />
              <p className="text-sm text-fg-muted">승인 상태를 확인하고 있어요…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg ring-1 ring-border">
                {COPY[state].icon}
              </div>
              <h2 className="text-base font-semibold text-fg">{COPY[state].title}</h2>
              <p className="text-sm leading-relaxed text-fg-muted">
                {COPY[state].body}
              </p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated px-4 text-sm font-medium text-fg shadow-sm transition-all hover:border-border-strong hover:shadow"
                >
                  <RefreshCw className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                  다시 확인
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-fg-subtle">
          승인되면 토큰이 자동으로 발급돼 바로 사용할 수 있어요.
        </p>
      </div>
    </div>
  );
}
