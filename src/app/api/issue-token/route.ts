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
 * POST /api/issue-token
 *
 * 현재 NextAuth 세션의 Google id_token 으로 agentclass 에 승인 확인 + 사용 토큰
 * (dsk_) 발급을 요청한다. 학생은 토큰을 직접 입력하지 않는다.
 *
 * 응답(agentclass 그대로 relay):
 *   { status:'active', token:'dsk_...' }   — 승인됨, 채팅 사용 가능
 *   { status:'pending', token:null }       — 선생님 승인 대기
 *   { status:'blocked', token:null }       — 사용 제한
 *   { status:'api_disabled', token:null }  — API 일시 중지
 *   { status:'no_session', token:null }    — 로그인 세션에 id_token 없음 (401)
 *   { status:'network_error', ... }        — 프록시 연결 실패 (502)
 *
 * active 일 때: 이 라우트는 Next.js 자식 프로세스 안에서 실행되므로, 발급된 토큰을
 * 이 프로세스의 process.env.ANTHROPIC_API_KEY 에 즉시 반영한다 → 재시작 없이 다음
 * 채팅 요청(/api/chat 이 process.env.ANTHROPIC_API_KEY 를 매 요청 읽음)부터 적용.
 * 영구 저장(safeStorage)은 렌더러가 반환된 token 으로 window.dscode.persistToken 을
 * 호출해 처리한다(다음 앱 실행 때 main.cjs 가 주입).
 */
export async function POST() {
  const session = await auth();
  const idToken = (session as { googleIdToken?: string } | null)?.googleIdToken;
  if (!idToken) {
    return NextResponse.json(
      { status: "no_session", token: null },
      { status: 401 },
    );
  }
  try {
    const r = await fetch(`${agentclassOrigin()}/api/dscode/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const j = (await r.json().catch(() => ({ status: "error", token: null }))) as {
      status?: string;
      token?: string | null;
    };
    // active + 토큰이면 이 Next 프로세스에 즉시 반영해 재시작 없이 채팅 가능하게 한다.
    if (r.ok && j?.status === "active" && typeof j.token === "string" && j.token) {
      process.env.ANTHROPIC_API_KEY = j.token;
    }
    return NextResponse.json(j, { status: r.ok ? 200 : r.status });
  } catch (e) {
    return NextResponse.json(
      {
        status: "network_error",
        token: null,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
