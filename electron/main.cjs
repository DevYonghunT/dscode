// DS Code Electron main process.
//
// 동작:
//   1. 저장된 학생 API 토큰 (safeStorage 암호화) 로드 시도 (없으면 null)
//   2. 토큰 유무와 무관하게 Next.js 를 자식 프로세스로 spawn
//      - 토큰 있으면 ANTHROPIC_API_KEY 주입 (+ ANTHROPIC_BASE_URL)
//      - 토큰 없으면 키 미주입 → 메인 창에서 Google 로그인 후 page.tsx 가 자동 발급
//        (/api/issue-token)하고 persist-token 으로 저장 → 다음 실행 때 주입됨
//   3. 포트 살아나면 main BrowserWindow 띄움
//   4. 종료 시 자식 Next 같이 kill
//
// 환경변수:
//   DSCODE_DEV_MODE=1           — `next dev` (HMR). 기본은 `next start` (build 필요)
//   DSCODE_DEV_TOOLS=1          — DevTools 자동 열기
//   DSCODE_NEXT_PORT            — 자식 Next 포트. 기본 3000
//   DSCODE_PROXY_BASE_URL       — 학교 프록시 URL. 기본 dev=localhost, prod=학교 도메인
//   DSCODE_URL                  — 외부 URL 강제 사용 (Next 자동 spawn skip)

const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog, nativeTheme } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

// 포트 전략 — PORT_POOL(3000~3009) 중 비어있는 첫 포트를 선택한다. OAuth(Google) 는
// "데스크톱 앱" 클라이언트를 쓴다. 데스크톱 클라이언트는 loopback redirect
// (http://localhost:<포트>/...) 를 포트와 무관하게 자동 허용하므로, 포트별 redirect URI
// 를 Google Cloud Console 에 등록할 필요가 없다.
//   예: http://localhost:<선택포트>/dscode/api/auth/callback/google
// 호스트는 반드시 localhost 로 통일한다 — Next 의 standalone 서버(next start)가 요청
// URL 의 host 를 항상 'localhost' 로 만들고 NextAuth 가 그 origin 으로 redirect_uri 를
// 만들기 때문이다(Host 헤더/127.0.0.1 로는 못 바꾼다). 그래서 창(BrowserWindow)·AUTH_URL·
// 콜백을 전부 localhost 로 맞춰야 세션 쿠키 origin 이 일치한다.
// 선택된 포트는 자식 Next 의 AUTH_URL 로 주입돼 NextAuth 세션/콜백도 같은 포트를 쓴다.
//
// DSCODE_NEXT_PORT 가 명시되면 그 포트 고정(개발용).
const FIXED_PORT = process.env.DSCODE_NEXT_PORT
  ? parseInt(process.env.DSCODE_NEXT_PORT, 10)
  : null
const PORT_POOL = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009]
let NEXT_PORT = FIXED_PORT || 3000 // bootstrap() 에서 풀 중 빈 포트로 확정
const NEXT_MODE = process.env.DSCODE_DEV_MODE === '1' ? 'dev' : 'start'
const EXTERNAL_URL = process.env.DSCODE_URL
const PROJECT_ROOT = path.join(__dirname, '..')

/** 특정 포트가 비어있는지(바인딩 가능한지) 검사. 0.0.0.0 으로 바인딩해 IPv4 전체
 *  점유(예: Python 0.0.0.0:3000)와도 확실히 충돌 감지. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', () => resolve(false))
    srv.listen(port, '0.0.0.0', () => {
      srv.close(() => resolve(true))
    })
  })
}

/**
 * 해당 포트에 이미 HTTP 응답하는 서버가 있는지 검사.
 * isPortFree(bind 테스트)만으로는 부족하다 — Python http.server 등은 SO_REUSEADDR
 * 로 떠서 우리 bind 테스트를 통과시키지만, 실제 요청은 그 서버가 가로채 404 를 준다.
 * 그래서 "응답하는 서버가 없는" 포트를 골라야 한다.
 */
function isHttpServerThere(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 700 }, (res) => {
      res.resume()
      resolve(true) // 누군가 응답함 = 사용 중
    })
    req.on('error', () => resolve(false)) // connection refused = 빈 포트
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * PORT_POOL 중 (1) 이미 HTTP 서버가 없고 (2) bind 가능한 첫 포트 반환. 다 막혔으면 null.
 * 두 조건 모두 봐야 esp32 Python(SO_REUSEADDR) 같은 기존 서버 포트를 피한다.
 */
async function pickPoolPort() {
  for (const p of PORT_POOL) {
    if (await isHttpServerThere(p)) continue // 기존 서버 있음 → skip
    if (await isPortFree(p)) return p
  }
  return null
}

const DEFAULT_PROXY_URL =
  NEXT_MODE === 'dev'
    ? 'http://localhost:3000/api/dscode/anthropic'
    : 'https://duksoo.agentclass.org/api/dscode/anthropic'
const PROXY_BASE_URL = process.env.DSCODE_PROXY_BASE_URL || DEFAULT_PROXY_URL

const TOKEN_FILE = path.join(app.getPath('userData'), 'api-token.bin')
const AUTH_SECRET_FILE = path.join(app.getPath('userData'), 'auth-secret.bin')
const LOG_FILE = path.join(app.getPath('userData'), 'main.log')

let mainWindow = null
let nextProcess = null

// ── 파일 로깅 (Windows GUI app 은 stdout 이 콘솔로 안 흘러나오므로 필수) ─────
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
} catch {
  /* userData 디렉토리 만들기 실패해도 다음 단계가 죽지는 않음 */
}
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function logLine(prefix, args) {
  const ts = new Date().toISOString()
  const msg = args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  try {
    logStream.write(`${ts} ${prefix} ${msg}\n`)
  } catch {
    /* ignore */
  }
}
const _origLog = console.log.bind(console)
const _origErr = console.error.bind(console)
console.log = (...args) => {
  logLine('[log]', args)
  _origLog(...args)
}
console.error = (...args) => {
  logLine('[err]', args)
  _origErr(...args)
}
console.log(`=== DS Code main process boot @ ${app.getVersion?.() || '?'} platform=${process.platform} ===`)
console.log(`logFile=${LOG_FILE}`)
console.log(`projectRoot=${PROJECT_ROOT} nextPort=${NEXT_PORT} mode=${NEXT_MODE} proxy=${PROXY_BASE_URL}`)

// ── 토큰 저장/로드 ────────────────────────────────────────────────────────────

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[dscode-electron] OS encryption unavailable — cannot decrypt token')
    return null
  }
  try {
    const enc = fs.readFileSync(TOKEN_FILE)
    return safeStorage.decryptString(enc)
  } catch (e) {
    console.error('[dscode-electron] token decrypt failed:', e.message)
    return null
  }
}

function saveToken(rawToken) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 OS 에서 보안 저장소를 사용할 수 없어요')
  }
  const enc = safeStorage.encryptString(rawToken)
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, enc, { mode: 0o600 })
}

function clearToken() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
}

// ── 기기별 세션 서명키 (AUTH_SECRET) ─────────────────────────────────────────
// 빌드에 포함된 .env.production 의 고정 AUTH_SECRET 을 쓰지 않는다. 고정값이
// 배포본에 평문으로 들어가면(=모든 학생 PC 동일) 유출 시 임의 학생의 NextAuth
// JWT 를 위조할 수 있고, 같은 값이 secrets 암호화 키 파생에도 쓰여 저장 토큰까지
// 복호화된다. 그래서 기기마다 1회 무작위 생성해 userData(사용자 전용, 배포본 밖)
// 에 저장한 값을 자식 Next 에 주입한다. 프로세스 env 가 .env 파일보다 우선이라
// NextAuth 는 이 값을 쓴다.
let cachedAuthSecret = null
function getMachineAuthSecret() {
  if (cachedAuthSecret) return cachedAuthSecret
  try {
    const v = fs.readFileSync(AUTH_SECRET_FILE, 'utf8').trim()
    if (v) {
      cachedAuthSecret = v
      return cachedAuthSecret
    }
  } catch {
    /* 파일 없음 → 아래에서 생성 */
  }
  cachedAuthSecret = crypto.randomBytes(32).toString('base64')
  try {
    fs.writeFileSync(AUTH_SECRET_FILE, cachedAuthSecret, { mode: 0o600 })
  } catch (e) {
    // 저장 실패 시 이번 실행 동안만 유효한 값 사용(다음 실행 때 재생성 → 재로그인 필요).
    console.error(`[auth-secret] persist 실패, 휘발성 값 사용: ${e.message}`)
  }
  return cachedAuthSecret
}

// ── Next.js 자식 프로세스 ─────────────────────────────────────────────────────

function buildChildEnv(token) {
  const env = { ...process.env }
  // 학생 배포 앱은 외부(부모 셸) 의 ANTHROPIC_* 를 절대 신뢰하지 않는다.
  // 학교 프록시 경유 + 학생 토큰을 무조건 강제로 덮어쓴다.
  //
  // 이유: 학생/개발자 노트북 셸에 `export ANTHROPIC_BASE_URL=https://api.anthropic.com`
  // 또는 `export ANTHROPIC_API_KEY=...` 가 있으면, 학생 토큰(dsk_)이 학교 프록시를
  // 거치지 않고 진짜 api.anthropic.com 으로 직행 → 401 "Invalid API key" 가 난다.
  // 그래서 외부 값이 무엇이든 무시하고 강제 설정한다.
  if (token) {
    env.ANTHROPIC_API_KEY = token
  } else {
    // 토큰이 없으면(미설정/최초 실행) 외부 키도 못 쓰게 제거. 키 없는 상태로 떠도
    // 메인 창에서 Google 로그인 → page.tsx 가 /api/issue-token 으로 자동 발급해
    // 채운다(그리고 persist-token 으로 저장 → 다음 실행 때 여기로 주입됨).
    delete env.ANTHROPIC_API_KEY
  }
  if (PROXY_BASE_URL) {
    env.ANTHROPIC_BASE_URL = PROXY_BASE_URL
  } else {
    delete env.ANTHROPIC_BASE_URL
  }
  // 부모 셸이 심어둘 수 있는 다른 인증/auth 우회 변수도 정리 (CLI 가 OAuth/Bedrock 등으로 새지 않게)
  delete env.ANTHROPIC_AUTH_TOKEN

  // NextAuth 의 세션/콜백 URL 을 실제 선택된 포트에 맞춘다. 이게 없으면 .env.production
  // 의 고정 AUTH_URL(3000) 을 쓰는데, 동적 포트면 로그인 리다이렉트가 엉뚱한 포트로
  // 가서 깨진다. 호스트는 localhost — Next 가 redirect_uri 의 host 를 localhost 로 강제
  // 하므로(위 포트 전략 주석 참고) AUTH_URL·창(loadAppURL)·콜백을 전부 localhost 로
  // 통일해야 세션 쿠키 origin 이 맞는다. basePath 까지 포함해야 올바른 redirect_uri 가 된다.
  if (!EXTERNAL_URL) {
    env.AUTH_URL = `http://localhost:${NEXT_PORT}/dscode/api/auth`
    env.NEXTAUTH_URL = env.AUTH_URL
    env.AUTH_TRUST_HOST = 'true'
  }

  // 세션 서명키는 빌드에 박힌 고정값 대신 기기별 생성값으로 강제 덮어쓴다.
  // (process env 가 .env.production 보다 우선 → NextAuth 가 이 값을 사용)
  env.AUTH_SECRET = getMachineAuthSecret()

  // TLS: 학교/백신/방화벽이 HTTPS 를 가로채 자체 서명 CA 를 끼우는 환경(SSL inspection)
  // 에서 NextAuth 의 Google 토큰 교환 fetch 가 SELF_SIGNED_CERT_IN_CHAIN 으로 실패한다.
  // Node 24 의 --use-system-ca 로 OS(Windows/macOS) 인증서 저장소(기업 CA 포함)를
  // 신뢰하게 해 검증을 유지하면서 통과시킨다. (일반 환경에선 표준 CA 라 무해)
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : ''}--use-system-ca`

  // 데스크톱 앱: 폴더 픽커가 학생 본인 PC 전체를 탐색·생성할 수 있게 한다.
  // (서버 모드엔 이 변수가 없어 HOME 밖 차단이 유지된다)
  env.DSCODE_DESKTOP = '1'
  return env
}

function spawnNext(token) {
  if (EXTERNAL_URL) return null
  // pnpm 의 node_modules/.bin/next 심볼릭은 electron-builder packaging 시
  // 사라지는 경우가 있다(.pnpm 평탄화 + symlink 깨짐). next 패키지의 entry script
  // 를 직접 Node 로 실행해서 .bin 의존 자체를 제거.
  //
  // process.execPath 는 Electron 바이너리. ELECTRON_RUN_AS_NODE=1 을 주면 일반
  // Node 처럼 동작 — 별도 Node 설치 없이 packaged 앱 안에서 동작 가능.
  const nextEntry = path.join(
    PROJECT_ROOT,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next',
  )
  console.log(`[spawnNext] execPath=${process.execPath}`)
  console.log(`[spawnNext] nextEntry=${nextEntry} exists=${fs.existsSync(nextEntry)}`)
  if (!fs.existsSync(nextEntry)) {
    console.error(`[spawnNext] FATAL: next entry not found — packaging 에 빠짐. PROJECT_ROOT 의 node_modules 확인 필요.`)
    // node_modules 디렉토리 전체 ls 로 어떤 게 있는지 로그
    try {
      const root = fs.readdirSync(path.join(PROJECT_ROOT, 'node_modules')).slice(0, 30).join(', ')
      console.error(`[spawnNext] node_modules sample: ${root}`)
    } catch (e) {
      console.error(`[spawnNext] node_modules read failed: ${e.message}`)
    }
    return null
  }
  let proc
  try {
    proc = spawn(
      process.execPath,
      // -H 127.0.0.1: 루프백에만 바인딩. 미지정 시 Next 기본값은 0.0.0.0(전체
      // 인터페이스)이라, 학생 PC 의 파일/채팅 API 와 학생 토큰을 보유한 이 서버가
      // 교내 LAN 의 다른 기기에 노출된다. 데스크톱 단일 사용자라 외부 노출은 불필요.
      [nextEntry, NEXT_MODE, '-p', String(NEXT_PORT), '-H', '127.0.0.1'],
      {
        cwd: PROJECT_ROOT,
        env: { ...buildChildEnv(token), ELECTRON_RUN_AS_NODE: '1' },
        // stdio 를 파일로 redirect — Windows GUI app 은 'inherit' 가 무의미
        stdio: ['ignore', logStream, logStream],
      },
    )
  } catch (e) {
    console.error(`[spawnNext] spawn threw:`, e)
    return null
  }
  console.log(`[spawnNext] spawned pid=${proc.pid}`)
  proc.on('error', (err) => {
    console.error(`[spawnNext] error event:`, err)
  })
  proc.on('exit', (code, signal) => {
    console.log(`[spawnNext] next exited code=${code} signal=${signal}`)
    nextProcess = null
    if (mainWindow && !app.isQuitting) app.quit()
  })
  return proc
}

function pingNext(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/dscode`, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForNext(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await pingNext(NEXT_PORT)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// ── 윈도우 ──────────────────────────────────────────────────────────────────

/**
 * 부팅 즉시 보여줄 스플래시 마크업. data: URL 로 로드되므로 외부 스크립트/링크
 * 없이 인라인 정적 HTML/CSS 만 사용한다(스플래시 창에도 동일 preload 가 붙음).
 * luxury 톤: 흰/네이비 배경 + gold accent, 보라 그라데이션 금지, 중앙 브랜딩 +
 * "준비 중..." + 부드러운 펄스. 다크 모드는 prefers-color-scheme 로 토큰 swap.
 */
function splashHtml() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root{--bg:#f8fafc;--fg:#1e293b;--muted:#64748b;--gold:#f59e0b;}
      @media (prefers-color-scheme: dark){
        :root{--bg:#0f0f11;--fg:#f8fafc;--muted:#94a3b8;--gold:#f59e0b;}
      }
      *{margin:0;padding:0;box-sizing:border-box;}
      html,body{height:100%;}
      body{
        display:flex;align-items:center;justify-content:center;
        background:var(--bg);color:var(--fg);
        font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif;
        -webkit-user-select:none;user-select:none;
      }
      .wrap{display:flex;flex-direction:column;align-items:center;gap:24px;}
      .brand{display:flex;align-items:center;gap:14px;}
      .dot{
        width:14px;height:14px;border-radius:9999px;background:var(--gold);
        animation:pulse 1.6s ease-in-out infinite;
      }
      .name{
        font-size:32px;font-weight:700;letter-spacing:-0.02em;
        font-family:'Outfit',-apple-system,sans-serif;
      }
      .name .accent{color:var(--gold);}
      .status{font-size:14px;font-weight:500;color:var(--muted);animation:fade 1.6s ease-in-out infinite;}
      @keyframes pulse{
        0%,100%{transform:scale(1);opacity:1;}
        50%{transform:scale(0.65);opacity:0.45;}
      }
      @keyframes fade{
        0%,100%{opacity:0.55;}
        50%{opacity:1;}
      }
    </style></head>
    <body><div class="wrap">
      <div class="brand">
        <span class="dot"></span>
        <span class="name">DS <span class="accent">Code</span></span>
      </div>
      <div class="status">준비 중...</div>
    </div></body></html>`
}

/**
 * 메인 BrowserWindow 를 생성하고 즉시 스플래시(data: URL)를 로드한다.
 * Next 부팅 완료를 기다리지 않고 먼저 호출돼 앱 실행 직후 창이 뜨게 한다.
 * 실제 앱 URL 전환은 loadAppURL() 이 담당. webPreferences/preload/
 * setWindowOpenHandler 등 기존 옵션은 그대로 보존한다.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'DS Code',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#f8fafc',
    webPreferences: {
      // 로그인 후 자동 발급받은 토큰을 렌더러가 window.dscode.persistToken 으로
      // 저장할 수 있도록 preload 노출. preload 가 ipcRenderer 를 쓰므로 sandbox 는
      // 꺼야 한다(settings 창과 동일한 이유). contextIsolation 은 유지해 안전.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })

  // 부팅 즉시 스플래시 표시 (Next ready 후 loadAppURL() 이 실제 앱으로 교체)
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`).catch(() => {
    /* 스플래시 로드 실패는 치명적이지 않음 — 곧 실제 URL 로 교체됨 */
  })

  if (process.env.DSCODE_DEV_TOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'right' })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 스플래시가 떠 있는 같은 창을 실제 앱 URL 로 전환한다(Next ready 후 호출).
 * 창 옵션/preload 는 createMainWindow 의 것을 그대로 재사용한다.
 */
function loadAppURL() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // localhost 로 로드 — Next 가 redirect_uri 를 localhost 로 강제하므로 창 origin 도
  // localhost 여야 콜백(localhost)과 origin 이 같아 세션 쿠키가 유지된다. (127.0.0.1 로
  // 로드하면 콜백이 localhost 로 와서 origin 불일치 → state 쿠키 유실 → 로그인 실패.)
  const url = EXTERNAL_URL || `http://localhost:${NEXT_PORT}/dscode`
  mainWindow.loadURL(url).catch((err) => loadErrorPage(url, err.message))
}

function loadErrorPage(url, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const html = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;padding:48px;color:#1e293b;background:#f8fafc;line-height:1.6;">
    <h1 style="font-weight:600;margin:0 0 8px;">DS Code 를 시작할 수 없어요</h1>
    <p style="margin:0 0 16px;color:#64748b;">${url} 에 연결되지 않습니다.</p>
    <pre style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${message}</pre>
    <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#1e293b;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">다시 시도</button>
  </body></html>`
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
    /* window 가 사라진 후 race, 무시 */
  })
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrapWithToken(token) {
  // 창을 먼저 띄워 스플래시를 보여준다(Next 부팅을 기다리지 않음). 학생이 앱이
  // 실행됐는지 알 수 있어 수 초간 빈 화면 → 중복 실행하는 문제를 막는다.
  createMainWindow()

  if (EXTERNAL_URL) {
    // 외부 URL 모드는 Next spawn 없이 바로 전환.
    loadAppURL()
    return
  }

  // 포트가 고정되지 않았으면 PORT_POOL(3000~3009) 중 빈 포트 선택.
  // 데스크톱 클라이언트가 loopback(localhost) 포트를 무시하므로 포트별 등록 불필요.
  if (!FIXED_PORT) {
    const picked = await pickPoolPort()
    if (picked) {
      NEXT_PORT = picked
      console.log(`[dscode-electron] picked pool port ${NEXT_PORT}`)
    } else {
      // 풀 전체가 막힘 — 그래도 3000 으로 시도(에러는 ready 타임아웃으로 안내)
      NEXT_PORT = 3000
      console.error('[dscode-electron] all pool ports busy, forcing 3000')
    }
  }
  console.log(`[dscode-electron] Next.js (${NEXT_MODE}) on :${NEXT_PORT}, proxy=${PROXY_BASE_URL}`)
  nextProcess = spawnNext(token)
  const ready = await waitForNext(NEXT_MODE === 'dev' ? 60000 : 30000)
  if (!ready) {
    console.error('[dscode-electron] Next.js did not become ready in time')
    // 실패 시 기존 에러 페이지 경로 유지(스플래시 창을 에러 페이지로 교체).
    loadErrorPage(`http://localhost:${NEXT_PORT}/dscode`, 'Next.js 가 제한 시간 내에 준비되지 않았습니다')
  } else {
    console.log('[dscode-electron] Next.js is ready')
    // 같은 창의 스플래시를 실제 앱 URL 로 전환.
    loadAppURL()
  }
}

function bootstrap() {
  // 토큰 유무와 무관하게 메인 창 + Next 를 띄운다. 토큰이 없으면(null) buildChildEnv 가
  // ANTHROPIC_API_KEY 를 주입하지 않고, 메인 창의 Google 로그인 후 page.tsx 가
  // /api/issue-token 으로 자동 발급해 채운다(수동 입력 불필요).
  bootstrapWithToken(loadToken())
}

// ── IPC ──────────────────────────────────────────────────────────────────────

// 이미 떠 있는 메인 윈도우(렌더러)가 로그인 후 자동 발급받은 dsk_ 토큰을 영구
// 저장(safeStorage)만 하기 위한 핸들러. Next spawn / 윈도우 생성 같은 부트스트랩은
// 하지 않는다(이미 다 떠 있음). 현재 세션 채팅에는 issue-token 라우트가 Next
// 프로세스의 process.env.ANTHROPIC_API_KEY 를 이미 갱신해 적용되고, 이 저장은
// "다음 앱 실행 때" main.cjs(bootstrap → loadToken)가 토큰을 주입하도록 보존하는 용도다.
ipcMain.handle('dscode:persist-token', (_e, rawToken) => {
  if (typeof rawToken !== 'string' || !rawToken.startsWith('dsk_') || rawToken.length < 16) {
    throw new Error('토큰 형식이 올바르지 않습니다 (dsk_ 로 시작해야 함)')
  }
  try {
    saveToken(rawToken)
    return true
  } catch (e) {
    console.error('[dscode-electron] persist-token failed:', e.message)
    // 보안 저장소가 없어도 현재 세션 채팅은 issue-token 의 env 주입으로 동작하므로,
    // 저장 실패를 치명적으로 던지지 않고 false 만 돌려준다(다음 실행 때 재발급됨).
    return false
  }
})

// ── 메뉴 ────────────────────────────────────────────────────────────────────

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'API 토큰 재설정…',
          click: async () => {
            const r = await dialog.showMessageBox(mainWindow || null, {
              type: 'warning',
              buttons: ['취소', '재설정'],
              defaultId: 0,
              cancelId: 0,
              title: 'API 토큰 재설정',
              message: '저장된 API 토큰을 삭제하고 앱을 재시작합니다.',
              detail: '다음 실행 시 로그인하면 토큰이 자동으로 다시 발급됩니다.',
            })
            if (r.response === 1) {
              clearToken()
              app.relaunch()
              app.exit(0)
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: '로그 폴더 열기',
          click: () => {
            shell.showItemInFolder(LOG_FILE)
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ])
}

// ── App lifecycle ───────────────────────────────────────────────────────────

// 중복 실행 방지: 락을 못 얻으면(이미 다른 인스턴스 실행 중) 즉시 종료한다.
// 스플래시가 떠도 학생이 모르고 두 번 실행하는 경우가 있어, 두 번째 실행은
// 새 창을 띄우지 않고 기존 창을 앞으로 가져온다.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 두 번째 실행 시도 → 기존 창 복원/포커스
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu())
    bootstrap()
  })
}

function killNext() {
  if (nextProcess && !nextProcess.killed) {
    try {
      nextProcess.kill('SIGKILL')
    } catch {
      /* 이미 죽음 */
    }
  }
}

app.on('before-quit', () => {
  app.isQuitting = true
  killNext()
})
// 비정상 종료(창 강제 닫기, 예외 등)에도 자식 Next 가 orphan 으로 남지 않게.
app.on('will-quit', killNext)
process.on('exit', killNext)
process.on('SIGINT', () => { killNext(); process.exit(0) })
process.on('SIGTERM', () => { killNext(); process.exit(0) })

app.on('window-all-closed', () => {
  // 데스크톱 앱: 창 닫으면 종료 (자식 Next 도 같이 정리). macOS 도 동일하게 처리해
  // dock 에 남아 자식 Next 가 orphan 으로 떠도는 것을 막는다.
  killNext()
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow) bootstrap()
})
