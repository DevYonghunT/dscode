import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { emailToUserId, getUserWorkspace } from "./workspace";
import { loadSecrets } from "./secrets";

/**
 * A "project" is a Claude Code session-scoped directory. Each has its own cwd
 * and its own `.claude/` history so the agent's conversation stays continuous
 * per-project.
 *
 * Three flavors:
 *  - `default` — always exists, maps to the user's legacy workspace root
 *  - `managed` (default for new projects) — lives at <users_root>/<email>/projects/<id>/
 *  - `external` — points at an arbitrary absolute path the user has on disk
 *                 (think VSCode's "Open Folder")
 */
export type Project = {
  id: string;
  name: string;
  root: string;
  createdAt: number;
  /** True when this project links to a folder outside our managed area. */
  external?: boolean;
};

type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  /** Absolute path on disk when this is an externally-linked folder. */
  externalPath?: string;
};

type Manifest = {
  projects: ProjectMeta[];
};

export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_NAME = "기본 (default)";

function usersRoot(): string {
  const fromEnv = process.env.DSCODE_USERS_ROOT;
  const raw = fromEnv || path.join(os.homedir(), ".dscode", "users");
  return path.resolve(raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw);
}

function userDir(email: string): string {
  return path.join(usersRoot(), emailToUserId(email));
}

function manifestPath(email: string): string {
  return path.join(userDir(email), "projects.json");
}

function projectsParent(email: string): string {
  return path.join(userDir(email), "projects");
}

async function readManifest(email: string): Promise<Manifest> {
  try {
    const raw = await fs.readFile(manifestPath(email), "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    if (Array.isArray(parsed.projects)) return parsed;
  } catch {
    /* fall through */
  }
  return { projects: [] };
}

async function writeManifest(email: string, m: Manifest): Promise<void> {
  const p = manifestPath(email);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(m, null, 2), { mode: 0o600, encoding: "utf8" });
}

function newProjectId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/** Expand `~`, resolve to absolute. */
function expandPath(input: string): string {
  const expanded = input.startsWith("~")
    ? path.join(os.homedir(), input.slice(1))
    : input;
  return path.resolve(expanded);
}

/** Hard-block obvious system paths and our own managed area to avoid foot-guns. */
function assertPathAllowed(abs: string): void {
  if (!path.isAbsolute(abs)) {
    throw new Error("절대 경로여야 합니다.");
  }
  const forbidden =
    process.platform === "win32"
      ? ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"]
      : ["/etc", "/var", "/usr", "/bin", "/sbin", "/System", "/private", "/dev", "/Library"];
  const absLower = abs.toLowerCase();
  if (
    forbidden.some((p) => {
      const pl = p.toLowerCase();
      return absLower === pl || absLower.startsWith(pl + path.sep);
    })
  ) {
    throw new Error("시스템 경로는 사용할 수 없습니다.");
  }
  const managed = usersRoot();
  if (abs === managed || abs.startsWith(managed + path.sep)) {
    throw new Error(
      `DScode가 관리하는 폴더(${managed})는 직접 지정할 수 없습니다.`,
    );
  }
}

async function isEmptyDir(abs: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(abs);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve & validate the user-chosen folder for a "external" (pre-existing) project.
 * The folder must already exist with read+write permissions.
 */
async function validateExternalPath(rawPath: string): Promise<string> {
  const abs = expandPath(rawPath.trim());
  assertPathAllowed(abs);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    throw new Error(`경로가 존재하지 않습니다: ${abs}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`디렉토리가 아닙니다: ${abs}`);
  }
  try {
    await fs.access(abs, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error(`이 폴더에 읽기/쓰기 권한이 없습니다: ${abs}`);
  }
  return abs;
}

/**
 * Resolve & prepare the folder for a fresh "empty" or "git" project.
 * Either it doesn't exist (we create it / let git create it) or it exists
 * but must be empty (so we don't silently scribble into someone's repo).
 */
async function prepareFreshPath(rawPath: string): Promise<string> {
  const abs = expandPath(rawPath.trim());
  assertPathAllowed(abs);
  let exists = false;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) {
      throw new Error(`이미 디렉토리가 아닌 파일이 같은 경로에 있습니다: ${abs}`);
    }
    exists = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  if (exists && !(await isEmptyDir(abs))) {
    throw new Error(
      `폴더가 비어있지 않습니다: ${abs} (빈 폴더를 지정하거나 "기존 폴더" 모드를 쓰세요)`,
    );
  }
  return abs;
}

/**
 * Resolve a project root. Externally-linked projects return their path as-is;
 * managed projects are lazily created on first access.
 */
export async function getProjectRoot(
  email: string,
  projectId: string,
): Promise<string> {
  if (projectId === DEFAULT_PROJECT_ID) {
    return getUserWorkspace(email);
  }
  if (!/^[a-z0-9_-]{4,32}$/i.test(projectId)) {
    throw new Error(`잘못된 프로젝트 ID: ${projectId}`);
  }
  const m = await readManifest(email);
  const meta = m.projects.find((p) => p.id === projectId);
  if (!meta) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
  if (meta.externalPath) {
    // Re-validate every access so we fail loudly if the user moved/deleted the folder.
    try {
      const stat = await fs.stat(meta.externalPath);
      if (!stat.isDirectory()) {
        throw new Error(`연결된 폴더가 디렉토리가 아닙니다: ${meta.externalPath}`);
      }
    } catch {
      throw new Error(
        `연결된 폴더에 접근할 수 없습니다 (이동·삭제됐을 수 있음): ${meta.externalPath}`,
      );
    }
    return meta.externalPath;
  }
  const root = path.join(projectsParent(email), projectId);
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function listProjects(email: string): Promise<Project[]> {
  const m = await readManifest(email);
  const defaultRoot = await getUserWorkspace(email);
  const defaultStat = await safeMtime(defaultRoot);
  const out: Project[] = [
    {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      root: defaultRoot,
      createdAt: defaultStat ?? 0,
    },
  ];
  for (const meta of m.projects) {
    out.push({
      id: meta.id,
      name: meta.name,
      root: meta.externalPath || path.join(projectsParent(email), meta.id),
      createdAt: meta.createdAt,
      external: Boolean(meta.externalPath),
    });
  }
  return out;
}

async function safeMtime(p: string): Promise<number | null> {
  try {
    const s = await fs.stat(p);
    return s.birthtimeMs || s.mtimeMs;
  } catch {
    return null;
  }
}

export type CreateProjectMode = "empty" | "git" | "external";

export type CreateProjectOpts = {
  mode: CreateProjectMode;
  /** Absolute (or `~`-prefixed) path on disk where this project will live. */
  path: string;
  /** Required when mode === "git". */
  gitUrl?: string;
};

export async function createProject(
  email: string,
  rawName: string,
  opts: CreateProjectOpts,
): Promise<Project> {
  const name = rawName.trim();
  if (!name) throw new Error("프로젝트 이름이 필요합니다.");
  if (name.length > 60) throw new Error("프로젝트 이름이 너무 깁니다 (60자 이하).");
  if (!opts.path || !opts.path.trim()) {
    throw new Error("작업할 폴더 경로가 필요합니다.");
  }
  if (opts.mode === "git" && !opts.gitUrl?.trim()) {
    throw new Error("GitHub URL이 필요합니다.");
  }

  const m = await readManifest(email);
  if (m.projects.some((p) => p.name === name)) {
    throw new Error("같은 이름의 프로젝트가 이미 있습니다.");
  }

  // Resolve & validate the chosen folder per mode.
  let abs: string;
  if (opts.mode === "external") {
    abs = await validateExternalPath(opts.path);
  } else {
    abs = await prepareFreshPath(opts.path);
  }

  // Don't allow two projects of this user to point at the same folder.
  if (
    m.projects.some(
      (p) => p.externalPath && path.resolve(p.externalPath) === abs,
    )
  ) {
    throw new Error("이 폴더는 이미 다른 프로젝트로 연결돼 있습니다.");
  }

  if (opts.mode === "empty") {
    await fs.mkdir(abs, { recursive: true });
  } else if (opts.mode === "git") {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // If we pre-created an empty dir above, remove it so `git clone` can populate it.
    try {
      const entries = await fs.readdir(abs);
      if (entries.length === 0) await fs.rmdir(abs);
    } catch {
      /* dir doesn't exist yet — fine */
    }
    const secrets = await loadSecrets(email);
    await cloneRepo(opts.gitUrl!.trim(), abs, secrets.github);
  }
  // For "external" the folder already exists with content — nothing to do.

  const id = newProjectId();
  const meta: ProjectMeta = {
    id,
    name,
    createdAt: Date.now(),
    externalPath: abs,
  };
  m.projects.push(meta);
  await writeManifest(email, m);
  return {
    id,
    name,
    root: abs,
    createdAt: meta.createdAt,
    // Only flag "external" in the UI when the user pointed at a pre-existing
    // folder. Empty/git projects are paths-the-user-chose-but-we-created,
    // which still feels "their folder" but doesn't deserve the badge.
    external: opts.mode === "external",
  };
}

function normalizeRepoRef(input: string): string {
  const s = input.trim();
  if (s.startsWith("git@")) return s;
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return s.endsWith(".git") ? s : `${s}.git`;
  }
  const cleaned = s.replace(/^github\.com\//, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    return `https://github.com/${cleaned}.git`;
  }
  throw new Error(`알 수 없는 GitHub URL 형식: ${input}`);
}

async function cloneRepo(
  rawUrl: string,
  destination: string,
  ghToken?: string,
): Promise<void> {
  const url = normalizeRepoRef(rawUrl);
  let cloneUrl = url;
  let needsRemoteRewrite = false;
  if (ghToken && url.startsWith("https://")) {
    const u = new URL(url);
    u.username = "oauth2";
    u.password = ghToken;
    cloneUrl = u.toString();
    needsRemoteRewrite = true;
  }

  await runCmd(
    "git",
    ["clone", "--depth", "1", cloneUrl, destination],
    { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    120_000,
  );

  if (needsRemoteRewrite) {
    try {
      await runCmd(
        "git",
        ["-C", destination, "remote", "set-url", "origin", url],
        {},
        15_000,
      );
    } catch {
      /* best-effort */
    }
  }
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string },
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const errChunks: Buffer[] = [];
    child.stderr.on("data", (d) => errChunks.push(d));
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (killed) return reject(new Error(`${cmd} 타임아웃`));
      if (code !== 0) {
        const err = Buffer.concat(errChunks).toString("utf8").trim();
        reject(new Error(`${cmd} 종료 코드 ${code}${err ? `: ${err}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

export async function deleteProject(
  email: string,
  projectId: string,
): Promise<void> {
  if (projectId === DEFAULT_PROJECT_ID) {
    throw new Error("기본 프로젝트는 삭제할 수 없습니다.");
  }
  const m = await readManifest(email);
  const idx = m.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) throw new Error("프로젝트를 찾을 수 없습니다.");
  const meta = m.projects[idx];
  m.projects.splice(idx, 1);
  await writeManifest(email, m);
  // For managed projects we delete the directory. For externally-linked ones
  // we only unlink — the user's actual folder is left untouched. This is the
  // VSCode "Remove Folder from Workspace" semantic.
  if (!meta.externalPath) {
    const root = path.join(projectsParent(email), projectId);
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
