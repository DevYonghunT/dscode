import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type BrowseEntry = {
  name: string;
  path: string;
  isEmpty: boolean;
  hidden: boolean;
};

export type Shortcut = { label: string; path: string };

// 데스크톱 앱(Electron)에서는 학생 본인 PC 전체를 탐색·생성할 수 있어야 한다.
// main.cjs 가 자식 Next 에 DSCODE_DESKTOP=1 을 주입한다. 서버(멀티유저) 모드에선
// 이 값이 없어 기존 HOME 제약이 유지된다.
const DESKTOP_MODE = process.env.DSCODE_DESKTOP === "1";

// 위험한 시스템 경로 차단 (양 모드 공통). OS 별로 다르다.
const FORBIDDEN_PREFIXES =
  process.platform === "win32"
    ? ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"]
    : ["/etc", "/var", "/usr", "/bin", "/sbin", "/System", "/private", "/dev", "/Library"];

/** Expand `~` and resolve to absolute path. */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return os.homedir();
  const expanded = trimmed.startsWith("~")
    ? path.join(os.homedir(), trimmed.slice(1))
    : trimmed;
  return path.resolve(expanded);
}

/** Block paths that the user shouldn't be poking at via the picker. */
export function assertBrowsable(abs: string): void {
  if (!path.isAbsolute(abs)) {
    throw new Error("절대 경로여야 합니다.");
  }
  // 서버(멀티유저) 모드에서만 HOME 밖을 막는다. 데스크톱 앱은 본인 PC 전체 허용.
  if (!DESKTOP_MODE) {
    const home = os.homedir();
    if (abs !== home && !abs.startsWith(home + path.sep)) {
      throw new Error("홈 디렉토리 밖은 탐색할 수 없습니다.");
    }
  }
  // 위험 시스템 경로는 양 모드 공통 차단 (대소문자 무시 — Windows 대비).
  const absLower = abs.toLowerCase();
  for (const p of FORBIDDEN_PREFIXES) {
    const pl = p.toLowerCase();
    if (absLower === pl || absLower.startsWith(pl + path.sep)) {
      throw new Error(`시스템 경로는 접근할 수 없습니다: ${abs}`);
    }
  }
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { label: "홈", path: os.homedir() },
  { label: "Documents", path: path.join(os.homedir(), "Documents") },
  { label: "Desktop", path: path.join(os.homedir(), "Desktop") },
  { label: "Downloads", path: path.join(os.homedir(), "Downloads") },
  { label: "Development", path: path.join(os.homedir(), "Development") },
  { label: "dscode-projects", path: path.join(os.homedir(), "dscode-projects") },
];

export async function browseDir(absInput?: string): Promise<{
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  shortcuts: Shortcut[];
}> {
  const abs = absInput ? expandPath(absInput) : os.homedir();
  assertBrowsable(abs);

  let raw: import("node:fs").Dirent[];
  try {
    raw = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    throw new Error(
      `폴더를 읽을 수 없습니다: ${abs} (${e instanceof Error ? e.message : e})`,
    );
  }

  const entries: BrowseEntry[] = [];
  for (const e of raw) {
    if (!e.isDirectory()) continue;
    const full = path.join(abs, e.name);
    // We may not be allowed to peek into every subdir; treat unreadable as empty.
    let isEmpty = true;
    try {
      const inner = await fs.readdir(full);
      isEmpty = inner.length === 0;
    } catch {
      isEmpty = true;
    }
    entries.push({
      name: e.name,
      path: full,
      isEmpty,
      hidden: e.name.startsWith("."),
    });
  }
  entries.sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
    return a.name.localeCompare(b.name, "ko");
  });

  const home = os.homedir();
  // 데스크톱 모드: 루트(/ 또는 C:\)까지 거슬러 올라갈 수 있게. 서버 모드: HOME 에서 멈춤.
  const parentDir = path.dirname(abs);
  const atTop = DESKTOP_MODE ? parentDir === abs : abs === home;
  const parent = atTop ? null : parentDir;

  // Filter shortcuts down to ones that actually exist on this box.
  const existingShortcuts: Shortcut[] = [];
  for (const s of DEFAULT_SHORTCUTS) {
    try {
      const stat = await fs.stat(s.path);
      if (stat.isDirectory()) existingShortcuts.push(s);
    } catch {
      // skip
    }
  }

  return { path: abs, parent, entries, shortcuts: existingShortcuts };
}

/** Create a new directory under `parent`. Returns the new absolute path. */
export async function makeDir(parentInput: string, name: string): Promise<string> {
  const parent = expandPath(parentInput);
  assertBrowsable(parent);
  const cleanName = name.trim();
  if (!cleanName) throw new Error("폴더 이름이 필요합니다.");
  if (/[\/\\]/.test(cleanName) || cleanName === "." || cleanName === "..") {
    throw new Error("폴더 이름에 사용할 수 없는 문자입니다.");
  }
  if (cleanName.length > 100) throw new Error("폴더 이름이 너무 깁니다.");
  const full = path.join(parent, cleanName);
  assertBrowsable(full);
  try {
    await fs.mkdir(full, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("같은 이름의 폴더가 이미 있습니다.");
    }
    throw e;
  }
  return full;
}
