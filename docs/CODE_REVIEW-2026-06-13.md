# DS Code 코드 리뷰 보고서

> 작성일 2026-06-13 · 대상 커밋 `6752a12` + 작업 트리(미커밋 변경 포함) · 범위 `src/`, `electron/`, 루트 설정

## 0. 리뷰 방법론 (투명성)

alibaba/open-code-review의 원칙(전체 컨텍스트 정독 → 라인 단위 지적 → 결함 중심 → 적대적 검증으로 false positive 최소화)을 멀티에이전트 워크플로우로 구현했다.

1. **매핑** — 5개 서브시스템(Electron 셸 / 인증·토큰 / 에이전트·채팅 / 서버 API / UI)을 병렬 정독, 신뢰 경계와 의심 포인트 추출.
2. **6차원 리뷰** — 보안·정확성·아키텍처·성능·UX(CLAUDE.md 디자인 원칙 대조)·빌드/배포.
3. **적대적 검증** — 발견마다 "반박 시도" + critical/major는 "영향도 평가" 2중 투표. 검증은 **Opus 4.8**로 수행(파일별 일괄), finder가 찾은 79건 중 **77건 검증 완료, 0건 기각**(심각도 일부 하향).
4. 미검증 2건(issue-token nit)은 그대로 포함, 완전성 비평은 §6에서 직접 보강.

총 79건의 보안/정확성 발견 + 98건의 아키텍처/성능/UX/빌드 발견을 통합. `npx tsc --noEmit`은 통과(타입 오류 없음).

---

## 1. Executive Summary

DS Code는 설계 의도(학교 프록시로 토큰을 자동 발급해 학생이 키를 다루지 않게 하는 것, safeStorage 암호화, 강제 종료 시 자식 정리 등)가 분명하고 코드 품질·주석 수준이 높다. **그러나 "데스크톱 단일 사용자 + 신뢰된 교내망"이라는 암묵적 전제가 코드 전반에 박혀 있고, 배포 패키징과 데이터 안전성에서 전제가 깨지는 순간 광범위 피해로 번지는 결함이 존재한다.**

| 심각도 | 건수(중복제거 전) | 핵심 주제 |
|---|---|---|
| 🔴 Critical | 3 테마 (raw 5) | 운영 시크릿 평문 배포 · 외부 레포 통째 삭제 · LAN 바인딩 |
| 🟠 Major | ~22 테마 (raw 28) | 경로/샌드박스 보안, 데이터 손실, 스트리밍 성능, 다크모드, 배포 운영 |
| 🟡 Minor | 81 | 접근성, 에러 UX, 영속화 안정성, 시크릿 파일 위생 |
| ⚪ Nit | 61 | 죽은 코드, 디자인 토큰 드리프트, 문서 부패 |

**위험 평가**: 현재 빌드 산출물(`dist-electron/*.dmg`, `*.exe`)이 이미 존재한다 → **이 상태로 배포하면 안 된다.** P0 3건은 출시 차단 사유다. 특히 시크릿 평문 배포는 이미 빌드했다면 **AUTH_SECRET·Google OAuth secret 즉시 로테이션**이 필요하다.

---

## 2. P0 — 출시 차단 (즉시 수정)

### 🔴 C1. 운영 시크릿이 모든 학생 PC에 평문 배포됨
**`package.json:21,34` · `.env.production` · `src/lib/secrets.ts:18,28`**

`electron-builder`의 `files`에 `.env.production`이 포함되고 `asar:false`라 **앱 번들 안에 평문 파일로** 들어간다(아카이브조차 아님 → 텍스트 에디터로 즉시 열림). 확인된 키: `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_URL`, `DSCODE_ADMIN_EMAILS`. Opus 검증 결과 값도 실제 운영 시크릿 포맷(`AUTH_GOOGLE_SECRET=GOC...`, `AUTH_SECRET` 44자 base64)으로 채워져 있다.

**연쇄 피해 (3중):**
- `AUTH_SECRET`은 NextAuth JWT 서명키(`src/auth.ts:76`, 30일) → 임의 이메일로 세션 위조 → `isEmailAllowed`(`auth.ts:12-17`) 도메인 검증 무력화 → **전체 라우트 세션 가드 우회**.
- 같은 `AUTH_SECRET`이 `secrets.ts:18`에서 AES-256-GCM 키 파생 입력으로 재사용(`DSCODE_SECRETS_KEY` 미설정 시 폴백) → **저장된 학생 GitHub/Vercel 토큰 복호화 가능**.
- Google OAuth client secret 전교생 노출 + 학생이 `DSCODE_ADMIN_EMAILS`를 직접 편집해 관리자 권한 취득 가능.

> **수정**: `files`에서 `.env.production` 제거. `AUTH_SECRET`은 main.cjs가 최초 실행 시 기기별 랜덤 생성 → safeStorage 저장 → 자식 env 주입. Google OAuth는 데스크톱용 PKCE public client(시크릿 불필요)로 전환하거나 시크릿을 학교 프록시 측에 둔다. `DSCODE_SECRETS_KEY`를 세션 서명키와 분리. **이미 배포된 빌드가 있으면 AUTH_SECRET·OAuth secret 즉시 로테이션.**

### 🔴 C2. 워크스페이스 리셋이 학생의 실제 레포를 통째로 삭제
**`src/app/api/workspace/route.ts:26-36` · `src/lib/projects.ts:205,309-314` · `src/components/SettingsModal.tsx:79`**

`DELETE /api/workspace`가 프로젝트 root의 모든 항목을 `fs.rm(recursive, force)`로 삭제한다. `getProjectRoot`는 **external(기존 폴더 연결) 프로젝트의 경우 사용자가 고른 실제 경로를 그대로 반환**하고, `createProject`는 default를 제외한 모든 프로젝트에 `externalPath`를 기록한다. `deleteProject`에는 external을 unlink만 하는 안전장치가 있는데 이 라우트가 그 비대칭을 우회한다.

> **재현(비가역)**: `기존 폴더` 모드로 `~/Development/내레포` 연결 → 설정 모달의 "워크스페이스 초기화" 클릭 → `.git` 포함 실제 레포 내용 전부 삭제. 고등학생이 자기 프로젝트 폴더를 연결한 상태에서 한 번의 오클릭으로 작업물 전체를 잃는다.
>
> **수정**: DELETE 핸들러에서 프로젝트 메타 조회 → `externalPath`가 있으면(또는 default가 아니면) 거부하거나 명시적 확인 플래그 없이는 403.

### 🔴 C3. Next 자식 서버가 `0.0.0.0`에 바인딩되어 교내 LAN 노출
**`electron/main.cjs:243`**

`spawnNext`가 `-H 127.0.0.1` 없이 실행 → Next 기본값 `0.0.0.0` 바인딩. 학생 PC의 Next 서버(파일 R/W API, `/api/chat`, dsk_ 토큰을 보유한 프로세스)가 같은 LAN의 다른 기기에서 `http://<학생IP>:3000~3009/dscode`로 접근 가능. **C1(AUTH_SECRET 유출)과 결합하면 원격에서 세션 위조 → 타 학생 PC의 파일시스템 조작·토큰 사용.**

> Opus 검증: 단독으로는 세션 가드가 1차 방어를 하므로 standalone은 major. 단 C1과 동시 존재하는 현 상태에서는 실질 critical. **수정은 `-H 127.0.0.1` 한 줄 추가 — 데스크톱 모드에서 부작용 0, 기능 손실 0.** 가장 비용 대비 효과가 큰 수정.

---

## 3. P1 — Major (다음 릴리스 전 수정)

### 3.1 보안 (경로·샌드박스·시크릿)
- **에이전트 무권한 실행** `agent.ts:232` — `permissionMode:'bypassPermissions'` + `allowDangerouslySkipPermissions:true`, 디렉터리/도구 화이트리스트 전무. `HOME`이 학생 실제 홈(`agent.ts:184`)이라 Bash/Read로 `~/.ssh`·브라우저 프로필 접근 가능, `GH_TOKEN/VERCEL_TOKEN`도 env 주입. 외부 콘텐츠(WebFetch/파일) 프롬프트 인젝션 시 임의 명령 실행 표면. → 위험 도구 권한 게이트 또는 OS 샌드박스(sandbox-exec/AppContainer)·디렉터리 제한 검토.
- **경로 컨테인먼트 결함 (2건)** — ① 첨부 `image.path`가 `safeResolve` 없이 `path.join`되어 `../../etc/passwd`로 워크스페이스 밖 파일을 모델로 유출(`agent.ts:122`, `chat/route.ts:36`은 `Array.isArray`만 검증). ② `safeResolve`가 `realpath`를 안 써서 심볼릭 링크 컨테인먼트 미보장(`workspace.ts:66`) — 에이전트가 `ln -s`로 만든 링크를 file/share 라우트가 따라감.
- **시크릿 파일 노출 (읽기·공유·내보내기)** — 트리는 dotfile을 숨기지만 파일 읽기 라우트(`file/route.ts`, **미인증 공개 공유** `share/[token]/file/route.ts:35`)는 `.env`·`.git/config`를 직접 path 지정으로 읽을 수 있다. zip 내보내기도 `.env`·`.git/config`를 제외 안 함(`export/route.ts:44`). → 라우트에 dotfile/민감경로 차단 추가, export는 화이트리스트.
- **id_token 클라이언트 노출** `auth.ts:53` — `session` 콜백이 Google id_token을 세션 객체에 실어 `GET /api/auth/session`으로 브라우저 JS에 노출. XSS 발생 시 학생 토큰 발급용 bearer 탈취. 서버는 `auth()`로 충분하므로 노출 라인 제거.
- **전역 env 토큰 오염** `issue-token/route.ts:99` — 토큰을 `process.env`에 덮어쓰고 chat이 세션 사용자와 무관하게 읽음. 코드가 서버(멀티유저) 모드를 지원(`fs-browser.ts:17`)하므로 공유 서버 배포 시 마지막 발급자 토큰을 전원이 공유. → 사용자별 저장 또는 `DSCODE_DESKTOP` 필수화.

### 3.2 데이터 무결성 (손실 버그)
- **512KB 초과 파일 저장 = 꼬리 데이터 영구 삭제** `file/route.ts:120` + `FileViewer.tsx:231` — GET이 앞 512KB만 주는데 PUT에 truncated 거부 가드가 없고 mtime 충돌검사도 통과(파일 불변). 한 글자 수정·저장 → 원본이 512KB로 잘림.
- **폴링이 미저장 편집을 덮어씀** `FileViewer.tsx:58` — 턴 종료 후 자동 리로드가 dirty 보호를 `mtime 변화`에만 걸어, 파일이 안 변했으면 입력 중이던 내용을 서버 내용으로 교체. → dirty면 mtime 무관하게 `setEditing` 스킵.
- **JSON 영속화 비원자적 + 조용한 초기화** `projects.ts:76`, `shares.ts`, `secrets.ts` — temp+rename 없이 직접 덮어쓰기 + 종료 시 SIGKILL(`main.cjs:472`)로 파일 truncate 가능. 읽기 측이 파싱 실패를 빈 객체로 폴백 → 깨진 manifest에서 프로젝트 1개 생성 시 **기존 목록·공유·시크릿 영구 소실**. → `write tmp → rename` + 실패 시 `.bak`·통지.
- **스트림 미중단 → busy 고착·세션 오염** `page.tsx:249` — 프로젝트/세션 전환이 `stop()` 없이 `resetChat()`만 호출. 이전 스트림이 계속 돌며 busy 잠금 + 이전 session 이벤트가 `currentSessionId` 덮어씀.
- **newSession/resume 의도 소실** `useChat.ts:94` — fetch 전에 의도를 소비·클리어하는데 실패/중단 시 복원 안 함 → 재전송이 `continue:true`로 엉뚱한 최근 세션에 붙음(세션 오귀속).

### 3.3 성능 (스트리밍·기동)
- **토큰마다 전 앱 리렌더 + O(n²) 마크다운** `useChat.ts:170` + `MessageBubble.tsx:109` — text_delta(토큰)마다 `turns` 배열 전체 재생성, 루트 Home 상태라 Header/SessionTree/FileViewer(Monaco 포함) 전부 리렌더. MessageBubble은 `memo` 없고 `markdownComponents`가 렌더마다 재생성 → 진행 중 버블이 누적 텍스트를 토큰마다 재파싱. → ref 누적 후 rAF/50ms flush + `React.memo` + 컴포넌트 상수화.
- **창 표시가 Next 부팅까지 지연** `main.cjs:359` — `waitForNext`(최대 30/60s) 완료 후에야 창 생성, 그 동안 화면 무. → whenReady 즉시 스플래시 창 + `requestSingleInstanceLock`.
- **`asar:false` + node_modules 통째** `package.json:26` — 설치본 수백 MB, devDependencies까지 포함, Windows Defender 실시간 검사로 콜드스타트 폭증. → `output:'standalone'` 또는 negative glob.

### 3.4 다크모드·UX
- **Monaco 테마 `vs` 고정** `CodeEditor.tsx:86` — 다크모드에서 파일 뷰어·공유 페이지 에디터 전체가 흰 배경(최대 면적 불일치). → `theme={isDark?'vs-dark':'vs'}`.
- **라이트 전용 하드코딩 색상** `MessageBubble.tsx:134` 외 다수 — `bg-red-50`/`hover:bg-red-700` 등이 다크모드에서 대비 2.5:1로 붕괴. CLAUDE.md 토큰 체계 밖. → `--danger-soft`/`--success` 토큰 추가 후 치환.
- **스트리밍 중 강제 자동 스크롤** `Chat.tsx:65` — 토큰마다 바닥으로 끌려가 답변 도중 위로 못 읽음. → sticky-bottom + "↓ 새 메시지" 버튼.

### 3.5 빌드·운영
- **자동 업데이트 경로 부재** `package.json:18` — electron-updater/publish 없음. 학생 PC 수백 대에 패치하려면 500MB 인스톨러 수동 재설치뿐 → 취약 버전 장기 잔존. → electron-updater + 학교 서버/Releases publish, mac에 zip target 추가.
- **Windows 미서명** `package.json:54` — SmartScreen 경고·백신 차단·변조 무검증. (mac은 notarize 완비.) → OV/EV 인증서 또는 Azure Trusted Signing.
- **포트 선택 TOCTOU + IPv6 미감지 + 풀 고갈 시 3000 강제** `main.cjs:347` — 검사~spawn 사이 점유 시 EADDRINUSE 즉사, `::1` 전용 서버 미감지, 풀 고갈 시 충돌. 교실(3000~3009에 esp32/python 흔함)에서 "앱이 안 떠요" 재현성 높음. → EADDRINUSE 감지 후 다음 포트 재시도 + `::1` 핑 + dialog 안내.

---

## 4. P2 — Minor (81건, 주제별 요약)

- **접근성(UX)** — 모달 포커스 트랩·`dialog` 시맨틱 부재, 드롭다운 `aria-expanded`/키보드 내비 없음, 리사이즈 핸들 키보드 불가, `--fg-subtle` 대비 미달(2.4:1), 동적 상태 `aria-live` 부재. (학교는 접근성 의무 대상일 수 있음 — 일괄 정비 권장.)
- **에러 UX** — 영어 원문 에러 노출(`useChat.ts:243`), 세션 로드 실패 무반응(`page.tsx:285`), 에러/빈 상태 혼동(`SessionTree.tsx:115`), 중단 후 피드백·재시도 부재, 저장 실패 시 편집 내용 소실로 보임, 네이티브 `alert/confirm` 사용.
- **시크릿 위생(보안)** — share 토큰 만료/스냅샷 없음(라이브 FS 영구 노출), `will-navigate` 가드·persist-token IPC sender 검증 부재, `DSCODE_PROXY_BASE_URL` 무검증, `fs/browse·mkdir`가 PC 전체 탐색, 로그아웃 후 dsk_ 토큰 잔존(공용 PC), git clone 실패 시 `.git/config`에 토큰 잔존.
- **영속화·정확성** — SSE가 done 없이 끝나면 스피너 영구 잔류, 서브에이전트 `parent_tool_use_id` 미필터, `body.model` 화이트리스트 없음, PUT mtime TOCTOU, 한글 파일명 미매치(`FILE_PATH_RE`), 업로드가 브라우저 MIME에만 의존(.ts/.md 실패).
- **성능** — Monaco/Pretendard CDN 런타임 로드(학교망 실패 위험), 검색이 키입력마다 풀스캔+전체읽기, `SKIP_DIRS`에 `.venv/__pycache__/target` 누락, 검색 무한깊이 재귀(심링크 루프).
- **빌드** — entitlements 과다(hardened runtime 약화), SDK 메인↔네이티브 버전 정합, win32-arm64 3중 불일치, README/HANDOFF 문서 부패.

## 5. ⚪ Nit (61건)
죽은 코드(`FileTree.tsx` 325줄·빈 `api/logout`·`disabled=false`·`isBlock` 항상 false), 8px 그리드/버튼 라운딩 드리프트, 다크 토큰 수동 복붙, Windows에서도 ⌘K 표기, `mac identity` 개인명의 하드코딩, `.gitignore`의 `.env*`가 `.env.example`까지 제외 등. → 한가할 때 일괄 정리.

---

## 6. 커버리지 갭 (리뷰가 직접 보강)

자동 검증에서 다루지 않은, 그러나 운영상 중요한 누락:
- **테스트 부재** — 저장소에 테스트가 전혀 없다. 위 데이터 손실 버그(C2, 512KB, 폴링 덮어쓰기)는 모두 단위 테스트로 잡혔을 것. 최소한 파일 R/W·세션 영속화·경로 안전성에 회귀 테스트 권장.
- **관측성 부재** — `main.log` 파일 로깅뿐, 원격 에러 수집 없음. 학생 PC에서 발생한 문제를 교사가 진단할 방법이 없다.
- **데이터 보존/백업** — 학기말 프로젝트·세션(JSON 파일) 백업·이관 전략 부재.
- **공유 PC 시나리오** — 로그아웃 후 토큰 잔존(minor)과 결합해, 한 PC를 여러 학생이 쓰는 컴퓨터실 환경에서 계정 전환 안전성 점검 필요.

---

## 7. 우선순위 로드맵

| 시기 | 작업 |
|---|---|
| **즉시 (배포 차단 해제)** | C3 `-H 127.0.0.1`(1줄) · C2 external DELETE 거부 · C1 `.env.production` 배포 제외 + 시크릿 로테이션 |
| **1주차 (데이터 안전)** | 512KB 저장 차단 · FileViewer dirty 보호 · JSON 원자적 쓰기 · 스트림 stop()·세션 의도 복원 |
| **2~3주차 (보안 심화·성능)** | 경로 컨테인먼트(realpath·첨부 safeResolve) · dotfile/export 필터 · id_token 비노출 · 스트리밍 렌더 최적화 · Monaco 다크 테마 |
| **운영 (출시 후)** | electron-updater 도입 · Windows 코드서명 · standalone 빌드 다이어트 · 핵심 경로 테스트·관측성 |

> 가장 비용 대비 효과가 큰 3가지: **C3(1줄)**, **C2(조건 1개)**, **C1(files 1줄 제거 + 시크릿 이동)**. 이 셋만으로 위험 프로파일이 극적으로 낮아진다.
