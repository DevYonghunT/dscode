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

const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const NEXT_PORT = parseInt(process.env.DSCODE_NEXT_PORT || '3000', 10)
const NEXT_MODE = process.env.DSCODE_DEV_MODE === '1' ? 'dev' : 'start'
const EXTERNAL_URL = process.env.DSCODE_URL
const PROJECT_ROOT = path.join(__dirname, '..')

const DEFAULT_PROXY_URL =
  NEXT_MODE === 'dev'
    ? 'http://localhost:3000/api/dscode/anthropic'
    : 'https://duksoo.agentclass.org/api/dscode/anthropic'
const PROXY_BASE_URL = process.env.DSCODE_PROXY_BASE_URL || DEFAULT_PROXY_URL

const TOKEN_FILE = path.join(app.getPath('userData'), 'api-token.bin')

let mainWindow = null
let settingsWindow = null
let nextProcess = null

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
  // 부모 쉘의 빈 ANTHROPIC_API_KEY/BASE_URL 트랩 제거
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) {
    if (env[k] === '') delete env[k]
  }
  // 학생 토큰과 학교 프록시 주입. 이미 환경변수로 들어와 있으면 그것 우선.
  if (token && !env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = token
  if (PROXY_BASE_URL && !env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = PROXY_BASE_URL
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
  const proc = spawn(
    process.execPath,
    [nextEntry, NEXT_MODE, '-p', String(NEXT_PORT)],
    {
      cwd: PROJECT_ROOT,
      env: { ...buildChildEnv(token), ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  )
  proc.on('exit', (code, signal) => {
    console.log(`[dscode-electron] next exited code=${code} signal=${signal}`)
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
    backgroundColor: '#0f172a',
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

app.on('before-quit', () => {
  app.isQuitting = true
  if (nextProcess && !nextProcess.killed) nextProcess.kill('SIGTERM')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow && !settingsWindow) bootstrap()
})
