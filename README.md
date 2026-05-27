# DukSoo Code (DS Code)

덕수고등학교 학생/교사 전용 **AI 코딩 에이전트 웹앱**.
Claude Agent SDK 위에서 동작하며, `@duksoo.hs.kr` Google Workspace 계정으로만 접속할 수 있습니다.
각 사용자는 **이메일에 묶인 영구 작업 공간**을 부여받아, 다른 기기·다른 날에 로그인해도 동일한 파일과 대화 이력이 유지됩니다.

`duksoo.agentclass.org/dscode` 같은 서브패스 배포를 전제로 설계되어 있습니다.

## 아키텍처

```
                    duksoo.agentclass.org
                            │
                            ▼ (reverse proxy: /dscode → :3000)
┌───────────────────────────────────────────────────────────────┐
│            Next.js 16 (basePath: /dscode)                     │
│                                                               │
│  ┌─ Login (Google OAuth) ──► @duksoo.hs.kr 검증 ─┐            │
│  │                                               ▼            │
│  ▼                              ~/.dscode/users/<email>/      │
│  Chat UI ──► /api/chat ──► Claude Agent SDK ──► workspace/    │
│              /api/tree                          .claude/     │
│              /api/file                          (대화 이력)    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

핵심 포인트:
- **인증**: Google OAuth (NextAuth v5), `signIn` 콜백에서 이메일 도메인 검증
- **세션**: JWT 쿠키 (HttpOnly, Secure)
- **워크스페이스**: `~/.dscode/users/<sanitized-email>/workspace/` — 영구
- **대화 연속성**: Claude Agent SDK가 `cwd`의 `.claude/` 에 자동으로 세션을 저장하므로, 사용자가 다시 로그인하면 같은 대화 흐름으로 이어집니다 (`continue: true` 옵션)

## 환경 변수

`.env.example`를 복사해 채워 넣으세요.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✓ | 학교 단일 Anthropic 키. 사용자에게 노출 안 됨 |
| `AUTH_GOOGLE_ID` | ✓ | Google Cloud OAuth 클라이언트 ID |
| `AUTH_GOOGLE_SECRET` | ✓ | Google Cloud OAuth 시크릿 |
| `AUTH_SECRET` | ✓ | NextAuth JWT 서명 시크릿. `openssl rand -base64 32` |
| `DSCODE_ALLOWED_DOMAIN` | | 접속 허용 도메인. 기본 `duksoo.hs.kr` |
| `DSCODE_ADMIN_EMAILS` | | 도메인 제한을 우회할 이메일 (쉼표 구분). 관리자/테스트 용 |
| `DSCODE_USERS_ROOT` | | 사용자별 워크스페이스 부모 경로. 기본 `~/.dscode/users` |
| `DSCODE_BASE_PATH` | | URL 서브패스. 기본 `/dscode` |
| `DSCODE_MODEL` | | Anthropic 모델. 기본 `claude-sonnet-4-6` |

## Google Cloud OAuth 설정

1. [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)에서 **OAuth 2.0 Client ID** 발급
2. Application type: **Web application**
3. Authorized JavaScript origins:
   - 운영: `https://duksoo.agentclass.org`
   - 로컬: `http://localhost:3000`
4. Authorized redirect URIs:
   - 운영: `https://duksoo.agentclass.org/dscode/api/auth/callback/google`
   - 로컬: `http://localhost:3000/dscode/api/auth/callback/google`
5. (선택) OAuth consent screen → "Internal" 로 설정하면 자동으로 `@duksoo.hs.kr` 외엔 접근 못 함

발급된 Client ID/Secret을 환경변수에 넣으면 됩니다.

## 시작하기

```bash
pnpm install
cp .env.example .env.local
# .env.local 편집: ANTHROPIC_API_KEY, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET
pnpm dev
```

`http://localhost:3000/dscode` 접속 → "Google 계정으로 로그인" → 학교 이메일로 인증.

> 💡 셸 환경에 빈 `ANTHROPIC_API_KEY=`가 설정돼 있다면 `.env.local` 값이 무시됩니다.
> 그럴 땐 `env -u ANTHROPIC_API_KEY pnpm dev` 로 실행하세요.

## 사용자 흐름

1. `duksoo.agentclass.org/dscode` 접속 → 로그인 화면
2. "Google 계정으로 로그인" 클릭 → Google 인증 → `@duksoo.hs.kr` 이메일 확인
3. 자동으로 `~/.dscode/users/<email>/workspace/` 디렉토리 생성 (이미 있으면 재사용)
4. 채팅으로 에이전트와 대화. 에이전트는 **이 디렉토리 안에서만** 작업
5. 로그아웃해도 파일·대화 이력 유지. 내일 다시 로그인하면 **이어서** 진행 가능
6. 설정 → "워크스페이스 초기화"로 자신의 데이터 전부 삭제 가능

## 영구 작업 공간 (Persistent workspace)

세션이 종료되어도 모든 것이 유지됩니다:
- 사용자가 작성한 파일 (코드, 데이터 등)
- Claude의 작업 이력 (`.claude/` 내 conversation log)
- 다음 로그인 시 `continue: true` 로 자동 resume → "어제 만든 함수 더 고쳐줘" 식으로 자연스럽게 이어짐

다른 기기에서 같은 Google 계정으로 로그인해도 동일한 워크스페이스에 접근합니다.

## 프로덕션 배포 (nginx 예시)

```nginx
location /dscode {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 600s;
}
```

운영 환경에선 `AUTH_TRUST_HOST=true` 또는 `NEXTAUTH_URL=https://duksoo.agentclass.org`도 설정.

## 에이전트 도구 (Claude Agent SDK 기본)

| 도구 | 설명 |
| --- | --- |
| `Read` | 파일 읽기 (라인 번호 포함) |
| `Write` | 파일 생성/덮어쓰기 |
| `Edit` / `MultiEdit` | 부분 편집 (정확한 문자열 교체) |
| `Bash` | 셸 실행 (cwd = 사용자 워크스페이스) |
| `Grep` / `Glob` | 검색 |
| `WebFetch` / `WebSearch` | 외부 정보 조회 |
| `Task` | 서브에이전트 위임 |

`permissionMode: "bypassPermissions"` + `settingSources: []` 로 호스트의 ~/.claude 설정/스킬/hooks가 사용자 세션에 새지 않도록 격리되어 있습니다.

## 알려진 제한 / 향후 개선

- **셸 격리**: `Bash` 도구는 워크스페이스를 cwd로 실행하지만 시스템 리소스 자체엔 접근 가능. 강한 격리는 Docker/Vercel Sandbox 추가 권장.
- **동시 사용성**: 매 채팅 호출마다 Claude Code CLI 서브프로세스 spawn. 다수 사용자가 동시에 사용하면 메모리/CPU 부담 발생.
- **워크스페이스 용량 제한 없음**: 사용자가 큰 파일 무한히 만들 수 있음. 디스크 모니터링 권장.
- **에디터**: 우측 패널은 읽기 전용. Monaco editor 통합 가능.

## 기술 스택

- Next.js 16 (App Router) + React 19
- @anthropic-ai/claude-agent-sdk (Claude Code 엔진)
- NextAuth v5 (Auth.js) + Google provider
- Tailwind CSS v4
- 디자인: Pretendard / Outfit · Navy(#1e293b) / White / Gold(#f59e0b)
- 교표: `public/duksoo-emblem.png` (PNG 없으면 SVG placeholder 폴백)

## 학교 교표 교체

`public/duksoo-emblem.png` 에 실제 교표 PNG를 저장하면 자동으로 우선 표시됩니다 (정사각형, 256×256 이상 권장).
PNG가 없으면 `public/duksoo-emblem.svg` placeholder 가 자동 폴백.
