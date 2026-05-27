# DScode — 다음 세션 인계 문서

> 다음 Claude Code 세션을 시작할 때 이 파일을 먼저 읽으세요.
> 새 세션 첫 메시지로 **"`HANDOFF.md` 읽고 어디까지 했는지 알려줘"** 하면 됩니다.

마지막 작업: **2026-05-28** · 작업자: claude-opus-4-7 세션

---

## 한줄 요약

Duksoo Code (DS Code) — 덕수고등학교 학생용 웹 코딩 에이전트. 현재 단일 사용자 완전 동작 + Google OAuth + Claude Agent SDK 통합 완료. **다음 단계는 Supabase 기반 교사·학생 멀티테넌트 구현** (계획만 수립, 미시작).

---

## 지금 상태

### 동작 중인 기능 (42개 태스크 완료)
- ✅ Google OAuth + `@duksoo.hs.kr` 도메인 제한
- ✅ Claude Agent SDK 통합 (Sonnet 4.6 / Opus 4.7 선택)
- ✅ 다중 프로젝트 (사용자 지정 로컬 폴더 / GitHub clone / 기존 폴더 연결)
- ✅ 폴더 픽커 (서버 fs 브라우저)
- ✅ 다중 세션 (한 프로젝트 안에 여러 세션 + 클릭으로 과거 대화 복원)
- ✅ Monaco 코드 에디터 + mtime 충돌 처리
- ✅ 파일/이미지 첨부 (SDK multimodal)
- ✅ 채팅 메시지/도구 카드 안의 파일명 클릭 → 편집기 열기
- ✅ WebSearch/WebFetch 결과 카드, git/vercel Bash 분기 시각화
- ✅ GitHub PAT / Vercel 토큰 (AES-256-GCM 암호화, gh/vercel CLI 자동 인증)
- ✅ 프로젝트 zip 다운로드 / 공유 URL (read-only)
- ✅ Cmd+K 통합 검색
- ✅ 3컬럼 리사이저블 패널 (직접 구현)
- ✅ 모델 선택기

### dev 서버
- 실행 중: `http://localhost:3000/dscode` (PID는 그때그때 확인)
- 종료하려면: `pkill -f "next dev"`
- 다시 띄우려면 **반드시**:
  ```bash
  env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL pnpm dev > /tmp/dscode-dev.log 2>&1
  ```
  (셸의 빈 `ANTHROPIC_API_KEY=` 변수가 `.env.local` 값을 덮어쓰는 걸 방지)

### Git
- **Git 저장소 아님**. `git init` 안 돼있음. 다음 세션에서 초기화하면 좋음.

### 환경
- macOS, Node 22, pnpm 10.4.1
- `gh` 2.87.0, `git` 2.50.1, `vercel` 54.2.0 설치돼 있음
- `.env.local`에 실제 ANTHROPIC_API_KEY + Google OAuth credentials + AUTH_SECRET 들어있음

---

## 운영 도메인

- 운영: `https://duksoo.agentclass.org/dscode/`
- 메인 사이트(`duksoo.agentclass.org`)는 별도 코드베이스. DS Code는 카드 1개로 추가될 예정 (학생 카드 우측에 "DS Code" 추가)

---

## 다음 작업: 교사·학생 멀티테넌트 (계획 승인됨, 미시작)

### 결정된 사항
- **방 단위**: 학생당 1개 (이미 이메일 기반으로 격리돼 있음)
- **교사 식별**: **Supabase**에 이미 있는 교사/학생 계정 정보 활용
- **승인 방식**: 수동 — 학생은 처음 로그인하면 `pending`, 교사가 대시보드에서 승인
- **API 토큰**: 관찰만 (할당량 자동 제한 X). 교사가 수동으로 API on/off
- **워크스페이스 관찰**: 파일 트리/내용 read-only (편집 불가)

### Phase별 계획
| Phase | 내용 | 산출물 |
|---|---|---|
| **1** | Supabase 연결 + role 조회 | `lib/supabase.ts`, `lib/account.ts`, auth.ts signIn 콜백 확장, `dscode_accounts` 테이블 마이그레이션 SQL |
| **2** | 학생 게이팅 | `/api/me`에 account 정보, `/api/chat`에 status/apiEnabled 체크, `PendingScreen`/`BlockedScreen`/`ApiDisabledBanner` |
| **3** | 교사 대시보드 | `/dscode/teacher` 페이지, 학생 목록 테이블 + 승인/차단/API 토글, `/api/admin/students*` |
| **4** | 워크스페이스 관찰 | 기존 share viewer 재활용, `/api/admin/students/<email>/{tree,file}` |
| **5** | 토큰 사용량 트래킹 | SDK result의 usage 추출 → Supabase `today_*` 카운터 증가, 날짜 바뀌면 reset |
| **6** | 메인 사이트 통합 안내 | 메인 레포에 카드 추가 명세만 (DS Code 쪽 작업 0) |

### 신규 Supabase 테이블 (Phase 1에서 생성)
```sql
create table dscode_accounts (
  email text primary key,
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  api_enabled boolean not null default false,
  joined_at timestamptz default now(),
  approved_at timestamptz,
  approved_by text,
  last_active_at timestamptz,
  today_date date,
  today_input_tokens int default 0,
  today_output_tokens int default 0,
  today_message_count int default 0
);
```

### 다음 세션에서 사용자에게 받아야 할 것
1. **Supabase URL** (`https://xxx.supabase.co`)
2. **Service Role Key** (서버에서 RLS 우회용. `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY=`로 추가)
3. **기존 사용자 테이블 정보**:
   - 테이블 이름 (예: `users`, `profiles`, `teachers`/`students` 분리?)
   - role 컬럼명 + 가능한 값 (예: `role` 컬럼에 `teacher`/`student`)
   - 이메일 컬럼명
   - 샘플 row 1~2개 (이름 컬럼 위치 확인)
4. `dscode_accounts` 테이블을 직접 만들어도 되는지(관리자 권한 확인)

이거 받으면 Phase 1부터 즉시 시작.

---

## 운영 배포 시 추가로 챙길 것 (메모)

### Google Cloud OAuth Client에 redirect URI 추가
```
https://duksoo.agentclass.org/dscode/api/auth/callback/google
```
**Authorized JavaScript origins**: `https://duksoo.agentclass.org`

### 운영 환경변수
```bash
AUTH_URL=https://duksoo.agentclass.org
DSCODE_PUBLIC_URL=https://duksoo.agentclass.org
NODE_ENV=production
AUTH_SECRET=<openssl rand -base64 32, 로컬과 다른 값>
```

### nginx 설정 예시
```nginx
location /dscode {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;             # SSE 끊김 방지
  proxy_read_timeout 600s;
}
```

---

## 코드 지도 (자주 보는 파일)

```
src/
├── app/
│   ├── page.tsx                 ← 메인 (Header, ResizableLayout, 모달 wiring)
│   ├── layout.tsx               ← 폰트, AuthProvider, 메타
│   ├── share/[token]/page.tsx   ← 공개 공유 페이지
│   └── api/
│       ├── chat/                ← SDK + SSE 스트리밍 (핵심)
│       ├── projects/[id]/       ← export, sessions, sessions/[id], shares
│       ├── share/[token]/       ← 공유 read 라우트
│       ├── fs/                  ← 폴더 픽커용 browse/mkdir
│       └── ... 그 외
├── components/
│   ├── Chat.tsx                 ← 입력창, 메시지 목록
│   ├── SessionTree.tsx          ← 좌측 사이드바
│   ├── FileViewer.tsx           ← 우측 Monaco 패널
│   ├── ResizableLayout.tsx      ← 3컬럼 드래그 (자체 구현, 라이브러리 안 씀)
│   ├── ProjectSwitcher.tsx      ← 헤더 프로젝트 드롭다운 + CreateProjectModal
│   ├── FolderPickerModal.tsx    ← 서버 fs 브라우저
│   ├── ModelPicker.tsx          ← Sonnet/Opus 선택
│   └── ... 그 외 모달들
├── lib/
│   ├── agent.ts                 ← SDK 호출, env 격리, 도구 + 시스템 프롬프트
│   ├── projects.ts              ← 프로젝트 CRUD, GitHub clone, 폴더 검증
│   ├── sessions.ts              ← .jsonl 파싱 (리스트 + 복원)
│   ├── workspace.ts             ← 이메일 → 경로 변환, safeResolve
│   ├── secrets.ts               ← AES-256-GCM 암호화 GH/Vercel 토큰
│   ├── shares.ts                ← 공유 토큰
│   ├── fs-browser.ts            ← 폴더 픽커 백엔드
│   └── session.ts               ← NextAuth 헬퍼 (requireUserOrRespond 등)
├── hooks/useChat.ts             ← 채팅 상태 + SSE 소비 + 모델/세션 옵션
└── auth.ts                      ← NextAuth 설정 (Google + 도메인 검증)
```

---

## 알려진 이슈/주의사항

- **셸 ANTHROPIC_API_KEY 빈 문자열 트랩**: 사용자 zsh에 `export ANTHROPIC_API_KEY=` (빈값)이 있어서, 그대로 `pnpm dev` 하면 .env.local 값이 무시되고 401 발생. 반드시 `env -u ANTHROPIC_API_KEY pnpm dev`.
- **Claude CLI Keychain OAuth 누수**: macOS Claude Code가 Keychain에서 자기 OAuth 토큰을 우선 잡으려고 함. `agent.ts`에서 `ANTHROPIC_CONFIG_DIR` 격리 + `CLAUDE_CODE_SKIP_*` env 6개로 차단해놨음. 이 부분 함부로 빼면 안 됨.
- **dscode_panel_layout_v3**: 리사이즈 패널 폭 저장 키. 만약 폭이 이상하면 localStorage에서 이 키만 지우면 기본 비율(280/flex-1/380)로 리셋됨.
- **localStorage 키들**: `dscode_active_project`, `dscode_model`, `dscode_layout_v3`

---

## 다음 세션 첫 메시지 추천

```
HANDOFF.md 읽고 어디까지 했는지 알려줘.
그리고 Supabase URL은 https://xxx.supabase.co,
service role key는 [붙여넣기],
기존 user 테이블은 [스키마 설명] 이야.
Phase 1 시작해줘.
```
