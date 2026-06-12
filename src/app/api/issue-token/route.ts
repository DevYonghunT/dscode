import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";

/**
 * 학교 프록시(agentclass) 의 origin 을 추출한다.
 *
 * main.cjs 가 ANTHROPIC_BASE_URL 을 학교 프록시 경로까지 포함한 형태로 주입한다
 * (예: https://duksoo.agentclass.org/api/dscode/anthropic). issue-token 엔드포인트는
 * 같은 도메인의 다른 경로(/api/dscode/issue-token)이므로, BASE_URL 에서 origin
 * (scheme://host[:port]) 만 뽑아 쓴다. 경로(/api/dscode/anthropic)는 버린다.
 */
function agentclassOrigin(): string {
  const base =
    process.env.ANTHROPIC_BASE_URL || process.env.DSCODE_PROXY_BASE_URL || "";
  const m = base.match(/^https?:\/\/[^/]+/);
  return m ? m[0] : "https://duksoo.agentclass.org";
}

/**
 * 이 Next 프로세스에 학생 토큰(dsk_)이 이미 있는지. main.cjs 가 부팅 때 safeStorage
 * 에서 읽어 주입했거나, 이전 issue-token 성공이 채워둔 값이다. 있으면 id_token
 * 재검증 없이도 채팅이 가능하다 (실제 차단·만료 검증은 학교 프록시가 매 요청 수행).
 */
function hasStoredToken(): boolean {
  return (process.env.ANTHROPIC_API_KEY || "").startsWith("dsk_");
}

/**
 * 발급 실패 시의 공통 응답. Google id_token 은 발급 1시간 뒤 만료되는 반면 로그인
 * 세션(JWT)은 30일 가므로, "세션은 살아있는데 id_token 으로 발급은 불가" 상태가
 * 정상 사용 중에도 흔하게 발생한다. 그때 저장된 dsk_ 토큰이 있으면 채팅을 막을
 * 이유가 없으므로 active 로 통과시킨다 (이 게이트는 안내용 UX 이고, blocked 등
 * 실제 차단은 프록시가 토큰 검증으로 강제한다).
 *
 *   kind=session   → 재로그인하면 해결되는 경우 (id_token 없음/만료/검증 실패)
 *   kind=transient → 재시도하면 해결될 수 있는 경우 (네트워크/프록시 일시 오류)
 */
function fallbackResponse(kind: "session" | "transient", message?: string) {
  if (hasStoredToken()) {
    return NextResponse.json({ status: "active", token: null, via: "stored" });
  }
  if (kind === "session") {
    return NextResponse.json(
      { status: "session_expired", token: null },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { status: "network_error", token: null, ...(message ? { message } : {}) },
    { status: 502 },
  );
}

/**
 * POST /api/issue-token
 *
 * 현재 NextAuth 세션의 Google id_token 으로 agentclass 에 승인 확인 + 사용 토큰
 * (dsk_) 발급을 요청한다. 학생은 토큰을 직접 입력하지 않는다.
 *
 * 응답:
 *   { status:'active', token:'dsk_...' }     — 새로 발급됨, 채팅 사용 가능
 *   { status:'active', token:null, via:'stored' }
 *                                             — 발급은 실패했지만 저장 토큰으로 사용 가능
 *   { status:'pending', token:null }          — 선생님 승인 대기
 *   { status:'blocked', token:null }          — 사용 제한
 *   { status:'api_disabled', token:null }     — API 일시 중지
 *   { status:'session_expired', token:null }  — 재로그인 필요 (id_token 없음/만료) (401)
 *   { status:'network_error', ... }           — 프록시 연결 실패, 재시도 (502)
 *
 * active(새 토큰) 일 때: 이 라우트는 Next.js 자식 프로세스 안에서 실행되므로, 발급된
 * 토큰을 이 프로세스의 process.env.ANTHROPIC_API_KEY 에 즉시 반영한다 → 재시작 없이
 * 다음 채팅 요청부터 적용. 영구 저장(safeStorage)은 렌더러가 반환된 token 으로
 * window.dscode.persistToken 을 호출해 처리한다(다음 앱 실행 때 main.cjs 가 주입).
 */
export async function POST() {
  const session = await auth();
  const idToken = (session as { googleIdToken?: string } | null)?.googleIdToken;

  // id_token 없음 — googleIdToken 저장 기능 이전에 만들어진 구버전 세션이거나,
  // 세션 자체가 없는 경우. 재로그인해야만 새 id_token 을 받을 수 있다.
  if (!idToken) {
    return fallbackResponse("session");
  }

  try {
    const r = await fetch(`${agentclassOrigin()}/api/dscode/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      status?: string;
      token?: string | null;
    };
    // active + 토큰이면 이 Next 프로세스에 즉시 반영해 재시작 없이 채팅 가능하게 한다.
    if (r.ok && j?.status === "active" && typeof j.token === "string" && j.token) {
      process.env.ANTHROPIC_API_KEY = j.token;
      return NextResponse.json(j);
    }
    // id_token 검증을 통과한 확정 상태 — 저장 토큰 유무와 무관하게 그대로 보여준다.
    if (
      j?.status === "pending" ||
      j?.status === "blocked" ||
      j?.status === "api_disabled"
    ) {
      return NextResponse.json(j);
    }
    // 401 = id_token 검증 실패(만료 포함) → 재로그인으로 해결.
    // 그 외(5xx 등)는 프록시 쪽 일시 오류 → 재시도로 해결될 수 있음.
    console.error(`[issue-token] relay failed: HTTP ${r.status}`, j);
    return fallbackResponse(
      r.status === 401 ? "session" : "transient",
      `HTTP ${r.status}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[issue-token] relay network error:", msg);
    return fallbackResponse("transient", msg);
  }
}
