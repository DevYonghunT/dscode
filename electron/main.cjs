// DS Code Electron main process.
//
// 동작:
//   1. 저장된 학생 API 토큰 (safeStorage 암호화) 로드 시도
//   2. 없으면 settings 윈도우 띄워 입력받고 OS keychain 에 저장
//   3. Next.js 를 자식 프로세스로 spawn (ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL 주입)
//   4. 포트 살아나면 main BrowserWindow 띄움
//   5. 종료 시 자식 Next 같이 kill
//
// 환경변수:
//   DSCODE_DEV_MODE=1           — `next dev` (HMR). 기본은 `next start` (build 필요)
//   DSCODE_DEV_TOOLS=1          — DevTools 자동 열기
//   DSCODE_NEXT_PORT            — 자식 Next 포트. 기본 3000
//   DSCODE_PROXY_BASE_URL       — 학교 프록시 URL. 기본 dev=localhost, prod=학교 도메인
//   DSCODE_URL                  — 외부 URL 강제 사용 (Next 자동 spawn skip)

const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog, nativeTheme } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

// 포트 전략 — OAuth(Google) redirect_uri 가 고정 URL 을 요구하므로, 완전 임의 포트는
// 쓸 수 없다. 대신 PORT_POOL(3000~3009) 중 비어있는 첫 포트를 선택한다.
// Google Cloud Console 에 이 10개 포트의 redirect URI 가 모두 등록돼 있어야 한다:
//   http://localhost:3000/dscode/api/auth/callback/google ... 3009
// 선택된 포트는 자식 Next 의 AUTH_URL 로 주입돼 NextAuth 콜백도 같은 포트를 쓴다.
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
const LOG_FILE = path.join(app.getPath('userData'), 'main.log')

let mainWindow = null
let settingsWindow = null
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
    // 토큰이 없으면(미설정) 외부 키도 못 쓰게 제거 — settings 창에서 입력받아야 함
    delete env.ANTHROPIC_API_KEY
  }
  if (PROXY_BASE_URL) {
    env.ANTHROPIC_BASE_URL = PROXY_BASE_URL
  } else {
    delete env.ANTHROPIC_BASE_URL
  }
  // 부모 셸이 심어둘 수 있는 다른 인증/auth 우회 변수도 정리 (CLI 가 OAuth/Bedrock 등으로 새지 않게)
  delete env.ANTHROPIC_AUTH_TOKEN

  // NextAuth 콜백 URL 을 실제 선택된 포트에 맞춘다. 이게 없으면 .env.production 의
  // 고정 AUTH_URL(3000) 을 쓰는데, 동적 포트면 Google 콜백이 엉뚱한 포트로 가서
  // ERR_CONNECTION_REFUSED → 로그인 후 흰 화면이 난다.
  // basePath 까지 포함한 형태여야 NextAuth 가 올바른 redirect_uri 를 만든다.
  if (!EXTERNAL_URL) {
    env.AUTH_URL = `http://localhost:${NEXT_PORT}/dscode/api/auth`
    env.NEXTAUTH_URL = env.AUTH_URL
    env.AUTH_TRUST_HOST = 'true'
  }

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
      [nextEntry, NEXT_MODE, '-p', String(NEXT_PORT)],
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
    const req = http.get(`http://localhost:${port}/dscode`, (res) => {
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

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'DS Code 설정',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false, // safeStorage IPC 응답 받으려면 preload 가 ipcRenderer 써야 함
      nodeIntegration: false,
    },
  })
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.on('closed', () => {
    settingsWindow = null
    // 사용자가 토큰 저장 없이 창 닫으면 앱 종료
    if (!loadToken() && !app.isQuitting) {
      app.quit()
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'DS Code',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  const url = EXTERNAL_URL || `http://localhost:${NEXT_PORT}/dscode`
  mainWindow.loadURL(url).catch((err) => loadErrorPage(url, err.message))

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
  if (!EXTERNAL_URL) {
    // 포트가 고정되지 않았으면 PORT_POOL(3000~3009) 중 빈 포트 선택.
    // OAuth redirect_uri 가 이 포트에 맞아야 하므로 Google Console 에 10개 등록 필수.
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
    } else {
      console.log('[dscode-electron] Next.js is ready')
    }
  }
  createMainWindow()
}

function bootstrap() {
  const token = loadToken()
  if (token) {
    bootstrapWithToken(token)
  } else {
    createSettingsWindow()
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('dscode:save-token', async (_e, rawToken) => {
  if (typeof rawToken !== 'string' || !rawToken.startsWith('dsk_') || rawToken.length < 16) {
    throw new Error('토큰 형식이 올바르지 않습니다 (dsk_ 로 시작해야 함)')
  }
  saveToken(rawToken)
  if (settingsWindow) {
    settingsWindow.close()
    settingsWindow = null
  }
  await bootstrapWithToken(rawToken)
})

ipcMain.on('dscode:cancel-settings', () => {
  if (settingsWindow) settingsWindow.close()
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
            const r = await dialog.showMessageBox(mainWindow || settingsWindow || null, {
              type: 'warning',
              buttons: ['취소', '재설정'],
              defaultId: 0,
              cancelId: 0,
              title: 'API 토큰 재설정',
              message: '저장된 API 토큰을 삭제하고 앱을 재시작합니다.',
              detail: '다음 실행 시 새 토큰을 입력해야 합니다.',
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu())
  bootstrap()
})

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
  if (!mainWindow && !settingsWindow) bootstrap()
})
