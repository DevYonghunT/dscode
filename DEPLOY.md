# DS Code 배포 가이드

DS Code 데스크톱 앱(맥/윈도우)을 빌드해서 학생이 받을 수 있게 배포하는 전체 절차.
새 세션에서 이 문서만 보고 그대로 따라 하면 된다.

---

## 0. 큰 그림 — 두 저장소가 엮인다

| 저장소 | 로컬 경로 | 역할 |
|---|---|---|
| **DScode** | `~/Development/DScode` | Electron+Next.js 앱 소스. 여기서 빌드해 GitHub Release 에 올린다. |
| **agentclass** | `~/Development/agentclass` | 학교 사이트. `/dscode` 다운로드 페이지가 DScode 의 GitHub Release 를 가리킨다. |

- GitHub 저장소: **`github.com/DevYonghunT/dscode`** (private)
- 학생 다운로드 페이지: **https://duksoo.agentclass.org/dscode**
- 배포 = ① 맥/윈도우 빌드(+맥 노타라이즈) → ② GitHub Release 에 자산 업로드 → ③ 사이트가 자동으로 새 파일 서빙

다운로드 페이지는 `releases/latest/download/<고정 파일명>` 형태의 링크를 쓴다
(예: `.../releases/latest/download/DS.Code-0.1.0-arm64.dmg`). `/latest/` 는 "가장 최근
발행된 릴리스"로 리다이렉트되고, 거기서 **그 이름의 파일**을 찾는다. 따라서:

- **같은 버전 핫픽스(§4):** `v0.1.0` 이 계속 최신 릴리스인 한, 그 태그에 같은 이름으로
  파일만 덮어쓰면(`--clobber`) 사이트는 코드 수정 없이 새 파일을 서빙한다.
- **버전 올리기(§5):** 파일명이 `0.2.0` 으로 바뀌면 `/latest/download/DS.Code-0.1.0-...`
  링크는 404 가 된다. 그래서 사이트의 링크 3개도 새 파일명으로 같이 고쳐야 한다.

> ⚠️ 핫픽스 `--clobber` 트릭은 **`v0.1.0` 이 여전히 최신 릴리스일 때만** 통한다.
> 이미 `v0.2.0` 같은 더 높은 릴리스를 발행한 뒤라면 `/latest` 가 그쪽을 가리켜
> 옛 태그에 다시 올려도 학생에게 닿지 않는다. 핫픽스는 새 버전 발행 전에.

---

## 1. 사전 준비 (최초 1회)

### 1-1. 도구
- Node + pnpm (저장소에서 이미 사용 중)
- `electron-builder` (devDependency 에 포함, 별도 설치 불필요)
- GitHub CLI `gh` — `gh auth status` 로 `DevYonghunT` 계정이 로그인돼 있어야 함

### 1-2. 맥 코드사이닝 / 노타라이즈 자격증명
`package.json` 의 `build.mac` 이 다음을 요구한다(이미 설정돼 있음):
- `identity: "Yonghun Kim (3WPS7QNZV5)"` — Developer ID Application 인증서가 **로그인 키체인에 설치**돼 있어야 함
- `hardenedRuntime: true`, `notarize: true`, `entitlements: build/entitlements.mac.plist`

노타라이즈는 빌드 시 **환경변수 3개**로 Apple 에 제출한다:

```bash
export APPLE_ID='애플 ID 이메일'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'   # ⚠️ 앱 암호 (계정 비번 아님)
export APPLE_TEAM_ID='3WPS7QNZV5'
```

> **⚠️ `APPLE_APP_SPECIFIC_PASSWORD` 는 Apple 계정 비밀번호가 아니다.**
> appleid.apple.com → 로그인 및 보안 → 앱 암호 에서 발급하는 `abcd-efgh-ijkl-mnop`
> 형태(소문자+하이픈, 특수문자 없음)다. 계정 비밀번호(느낌표 등 포함)를 넣으면
> 2단계 인증 때문에 노타라이즈가 실패한다.
> 값에 특수문자가 있으면 **작은따옴표**로 감싼다 (zsh 는 큰따옴표 안의 `!` 를
> 히스토리 확장으로 해석해 깨진다).

이 export 들은 **새 터미널마다 다시 해야 한다.** 과거에 입력한 적이 있으면
`grep "APPLE_" ~/.zsh_history` 로 찾아 재사용할 수 있다.

---

## 2. 빌드

### 빌드 전 체크리스트
```bash
cd ~/Development/DScode
git status --short                                  # ① 비어 있어야 함 (커밋된 소스가 빌드됨 → 배포본과 커밋 일치)
pkill -f "DS Code" 2>/dev/null || true              # ② 실행 중인 DS Code 종료
security find-identity -p codesigning -v | grep Yonghun   # ③ 서명 인증서 존재 확인 (출력 없으면 키체인에 인증서 없음)
echo "${APPLE_ID:?APPLE_ID 미설정}"                  # ④ 노타라이즈 환경변수 3개 export 됐는지
```

### 빌드 실행
```bash
# 위 APPLE_* 3개를 export 한 같은 셸에서:
pnpm dist:all      # next build + electron-builder -mw (맥 dmg ×2 + 윈도우 exe)
```

- `pnpm dist:mac` / `pnpm dist:win` 으로 한쪽만도 가능하지만, 각각 `next build` 를
  다시 돈다. `dist:all` 은 `next build` 를 한 번만 돌려 맥+윈도우를 패키징하므로 더 빠르다.
- 산출물은 `dist-electron/` 에 생긴다 (출력 디렉토리는 `package.json` 의
  `build.directories.output`).
- 맥 빌드는 서명 + Apple 노타라이즈 때문에 몇 분 걸린다. 윈도우 exe 는 이 맥에서
  크로스 빌드된다.

### 산출 파일 (버전 0.1.0 기준)
| 플랫폼 | `dist-electron/` 파일명 (공백 있음) |
|---|---|
| 맥 Apple Silicon | `DS Code-0.1.0-arm64.dmg` |
| 맥 Intel | `DS Code-0.1.0.dmg` |
| 윈도우 x64 | `DS Code Setup 0.1.0.exe` |

빌드 로그에 무해한 경고들이 섞여 나온다(Turbopack NFT 경고, description/author
누락, `asar` 비활성, electron-builder 새 버전 알림) — 전부 무시해도 된다.

---

## 3. 노타라이즈 검증 (맥)

빌드 로그에 이 줄이 보이면 **노타라이즈가 빠진 것** → APPLE_* 환경변수를 확인하고 다시 빌드:

```
• skipped macOS notarization  reason=`notarize` options were unable to be generated
```

정상 빌드 후 검증:

```bash
xcrun stapler validate "dist-electron/mac-arm64/DS Code.app"   # arm64
xcrun stapler validate "dist-electron/mac/DS Code.app"          # intel
# 둘 다 "The validate action worked!" 가 나와야 한다.
spctl -a -vv "dist-electron/mac-arm64/DS Code.app"             # → source=Notarized Developer ID
```

> **DMG 파일 자체**에 `stapler validate` 를 하면 "does not have a ticket stapled"
> 가 정상이다. electron-builder 는 DMG 가 아니라 **그 안의 `.app`** 에 티켓을
> 스테이플한다. 위처럼 `.app` 번들로 검증할 것.

---

## 4. GitHub Release 에 업로드

같은 버전 태그(`v0.1.0`)의 자산을 교체한다. `--clobber` 로 기존 파일을 덮어쓴다:

```bash
cd ~/Development/DScode
GH_TOKEN=$(gh auth token) gh release upload v0.1.0 -R DevYonghunT/dscode --clobber \
  "dist-electron/DS Code-0.1.0-arm64.dmg" \
  "dist-electron/DS Code-0.1.0.dmg" \
  "dist-electron/DS Code Setup 0.1.0.exe"
```

> **⚠️ `GH_TOKEN=$(gh auth token)` 접두사가 핵심이다.** 이 환경에서 `gh` 가
> 키체인 토큰을 쓰기 요청에 자동으로 붙이지 못해 **HTTP 401 Requires
> authentication** 으로 실패한다(읽기는 됨). 토큰을 환경변수로 직접 넘기면 통과한다.

> **파일명 공백 → 점 자동 변환:** GitHub 는 업로드 시 파일명의 **모든 공백을 점으로**
> 바꿔 저장한다. 업로드 명령엔 **로컬 공백 파일명**을 넣되, 사이트가 참조하는 실제
> GitHub 자산명은 점 버전이다:
>
> | 로컬 (`dist-electron/`) | GitHub 자산명 = 사이트 링크 |
> |---|---|
> | `DS Code-0.1.0-arm64.dmg` | `DS.Code-0.1.0-arm64.dmg` |
> | `DS Code-0.1.0.dmg` | `DS.Code-0.1.0.dmg` |
> | `DS Code Setup 0.1.0.exe` | `DS.Code.Setup.0.1.0.exe` (공백 2개 → 점 2개) |
>
> 업로드 후 아래 `gh api` 확인으로 실제 자산명을 한 번 보고 사이트 링크와 대조할 것.

업로드는 ~1.5GB 라 회선에 따라 수 분 걸린다. `--clobber` 가 기존 파일을 먼저 지우므로
업로드 중에는 다운로드 링크가 잠시 비는데, 짧으니 한가한 시간에 하면 된다.

### 업로드 확인
```bash
# 자산이 오늘 날짜로 교체됐는지
GH_TOKEN=$(gh auth token) gh api repos/DevYonghunT/dscode/releases/tags/v0.1.0 \
  -q '.assets[] | .name + "  " + (.size/1048576|floor|tostring) + "MB  " + .created_at'

# 사이트가 쓰는 실제 링크가 새 파일로 응답하는지 (Content-Length 확인)
curl -sIL "https://github.com/DevYonghunT/dscode/releases/latest/download/DS.Code-0.1.0-arm64.dmg" \
  | grep -i content-length | tail -1
```

---

## 5. 버전 번호를 올릴 때 (예: 0.1.0 → 0.2.0)

파일명이 바뀌므로 **사이트 링크 3개도 같이 고쳐야 한다.**

1. `~/Development/DScode/package.json` 의 `version` 을 올린다.
2. `pnpm dist:all` 로 새 파일명(`DS Code-0.2.0-arm64.dmg` …)을 만든다.
3. 새 Release/태그(`v0.2.0`)를 만들고 자산 업로드 (`gh release create` 는 태그가 없으면
   자동 생성한다):
   ```bash
   GH_TOKEN=$(gh auth token) gh release create v0.2.0 -R DevYonghunT/dscode \
     --title "DS Code 0.2.0" --generate-notes \
     "dist-electron/DS Code-0.2.0-arm64.dmg" \
     "dist-electron/DS Code-0.2.0.dmg" \
     "dist-electron/DS Code Setup 0.2.0.exe"
   ```
   (`--generate-notes` 는 직전 태그 이후 커밋으로 릴리스 노트를 자동 작성. 직접 쓰려면
   `--notes "내용"`.)
4. **agentclass 사이트의 링크를 새 파일명으로 수정** — 파일:
   `~/Development/agentclass/src/app/dscode/page.tsx` 의 `DOWNLOADS` 상수
   (`macArm` / `macIntel` / `windows`, 현재 `DS.Code-0.1.0-...` → `DS.Code-0.2.0-...`).
5. **agentclass 를 Vercel 에 배포** — agentclass 는 별도 저장소이므로 수정만으로는
   사이트에 반영되지 않는다. agentclass 의 평소 배포 방식대로 배포한다(보통 main 푸시 시
   Vercel 자동 배포, 또는 `~/Development/agentclass` 에서 `npx vercel deploy --prod`).
   배포 후 2~5분 뒤 다운로드 링크가 새 파일을 가리키는지 §4 의 `curl -sIL` 로 확인.

> 같은 버전에 핫픽스만 재배포할 때(§4)는 파일명이 그대로라 사이트를 안 건드려도 된다.
> 다만 학생 입장에선 받은 파일이 새 건지 구분이 안 되니, 의미 있는 변경은 버전을 올리는 게 좋다.

---

## 6. 학생이 받는 흐름 (참고)

사이트 다운로드 페이지(`/dscode`)는 게이트가 걸려 있다 (agentclass `download-gate.tsx`):

1. **로그인 안 함** → "학교 Google 계정으로 로그인" 버튼만 보임 (`/office/login?next=/dscode`)
2. **로그인 + 승인 대기(pending)** → "승인 대기 중" 안내, 다운로드 불가
3. **차단(blocked)** → 사용 제한 안내
4. **승인됨(active)** → macOS(Apple Silicon) / macOS(Intel) / Windows 카드 3개 노출

즉 학생은 **@duksoo.hs.kr 계정 로그인 + 선생님 승인(active)** 이 돼야 받을 수 있다.

### 맥에서 설치 / 업데이트
1. 실행 중인 DS Code 종료(Cmd+Q)
2. 사이트에서 `.dmg` 다운로드 → 열기 → 앱을 Applications 로 드래그 → "교체"
3. 노타라이즈가 됐으면 경고 없이 바로 열린다.
   - 설정·로그인·프로젝트 데이터는 `~/Library/Application Support/dscode` 에 따로 보존됨(덮어써도 유지)
   - 토큰 재발급이 필요하면 앱 메뉴 → "API 토큰 재설정…" 또는
     `rm ~/Library/Application\ Support/dscode/Cookies*` 후 재로그인

> **테스트는 사이트에서 받은 파일로 하는 게 좋다.** 로컬 `dist-electron/` 파일은
> quarantine 속성이 없어 Gatekeeper 검사 경로를 재현하지 못한다. 사이트 다운로드본은
> 학생과 동일한 경로(다운로드 → Gatekeeper 노타라이즈 검사)를 거친다.

---

## 7. 트러블슈팅 빠른 표

| 증상 | 원인 / 해결 |
|---|---|
| `gh release upload` → **HTTP 401 Requires authentication** | `gh` 가 키체인 토큰을 안 붙임. 명령 앞에 `GH_TOKEN=$(gh auth token)` 붙이기. |
| 빌드 로그 `skipped macOS notarization` | `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 미설정. export 후 재빌드. |
| 노타라이즈 인증 실패 | 앱 암호 대신 계정 비밀번호를 넣음. appleid.apple.com 앱 암호(`abcd-efgh-...`) 사용. |
| `export PW="...!..."` 가 `event not found` | zsh 히스토리 확장. **작은따옴표** `'...'` 로 감싸기. |
| 학생 맥에서 "확인할 수 없는 개발자" 차단 | 노타라이즈 빠진 빌드를 배포함. §3 으로 검증 후 재빌드·재업로드. |
| 사이트에서 받았는데 옛 버전 | 같은 태그에 자산을 안 덮어썼거나(§4 `--clobber`), 버전 올릴 때 사이트 링크를 안 고침(§5). |

---

## 8. 빠른 참조 (같은 버전 핫픽스 재배포, 복붙용)

```bash
cd ~/Development/DScode

# 1) 노타라이즈 자격증명 (새 셸마다)
export APPLE_ID='애플 ID 이메일'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'
export APPLE_TEAM_ID='3WPS7QNZV5'

# 2) 빌드 (맥+윈도우)
pnpm dist:all

# 3) 맥 노타라이즈 검증
xcrun stapler validate "dist-electron/mac-arm64/DS Code.app"
xcrun stapler validate "dist-electron/mac/DS Code.app"

# 4) GitHub Release 자산 교체
GH_TOKEN=$(gh auth token) gh release upload v0.1.0 -R DevYonghunT/dscode --clobber \
  "dist-electron/DS Code-0.1.0-arm64.dmg" \
  "dist-electron/DS Code-0.1.0.dmg" \
  "dist-electron/DS Code Setup 0.1.0.exe"

# 5) 확인
GH_TOKEN=$(gh auth token) gh api repos/DevYonghunT/dscode/releases/tags/v0.1.0 \
  -q '.assets[] | .name + "  " + (.size/1048576|floor|tostring) + "MB  " + .created_at'
```
