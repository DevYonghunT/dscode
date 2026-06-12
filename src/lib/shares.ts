import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Read-only share tokens. A token grants public access (no login) to view
 * the file tree and file contents of one project at the moment of issue.
 *
 * Storage: a single JSON file at ~/.dscode/shares.json mapping token → meta.
 * Good enough for a classroom-scale deployment.
 */

export type ShareRecord = {
  token: string;
  email: string; // owner
  projectId: string;
  createdAt: number;
};

function sharesRoot(): string {
  const fromEnv = process.env.DSCODE_USERS_ROOT;
  const base = fromEnv
    ? path.dirname(path.resolve(fromEnv))
    : path.join(os.homedir(), ".dscode");
  return base;
}

function sharesPath(): string {
  return path.join(sharesRoot(), "shares.json");
}

async function readAll(): Promise<Record<string, ShareRecord>> {
  const p = sharesPath();
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    // 파일이 없으면(최초 실행) 빈 맵으로 정상 처리.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw e;
  }
  // 파일은 있는데 파싱이 안 되면 "손상"으로 간주한다. 빈값으로 폴백하면
  // 이어지는 writeAll 이 빈 맵을 덮어써 기존 공유가 전부 소실되므로,
  // 손상 파일을 백업해 두고 명확한 Error를 던져 후속 덮어쓰기를 차단한다.
  try {
    const parsed = JSON.parse(raw) as Record<string, ShareRecord>;
    if (parsed && typeof parsed === "object") return parsed;
    throw new Error("객체 형식이 아닙니다.");
  } catch (e) {
    await backupCorrupt(p);
    throw new Error(
      `shares.json이 손상되어 읽을 수 없습니다 (백업 후 중단). 원인: ${
        (e as Error)?.message ?? e
      }`,
    );
  }
}

/**
 * 원자적 쓰기: 같은 디렉터리에 <파일>.tmp 로 먼저 쓴 뒤 rename 한다.
 * rename 은 동일 파일시스템에서 원자적이라 쓰기 도중 깨지지 않는다.
 */
async function writeFileAtomic(
  p: string,
  data: string,
  mode: number,
): Promise<void> {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, data, { mode, encoding: "utf8" });
  await fs.rename(tmp, p);
}

/** 손상된 파일을 <파일>.corrupt-<timestamp> 로 백업(rename)한다. */
async function backupCorrupt(p: string): Promise<void> {
  try {
    await fs.rename(p, `${p}.corrupt-${Date.now()}`);
  } catch {
    /* 백업 실패해도 원본을 덮어쓰지 않는 게 핵심이므로 무시 */
  }
}

async function writeAll(all: Record<string, ShareRecord>): Promise<void> {
  const p = sharesPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await writeFileAtomic(p, JSON.stringify(all, null, 2), 0o600);
}

function newToken(): string {
  // 24 bytes → 32 url-safe chars; not guessable, not too long for a URL.
  return crypto.randomBytes(24).toString("base64url");
}

export async function createShare(
  email: string,
  projectId: string,
): Promise<ShareRecord> {
  const all = await readAll();
  const rec: ShareRecord = {
    token: newToken(),
    email,
    projectId,
    createdAt: Date.now(),
  };
  all[rec.token] = rec;
  await writeAll(all);
  return rec;
}

export async function listSharesForProject(
  email: string,
  projectId: string,
): Promise<ShareRecord[]> {
  const all = await readAll();
  return Object.values(all)
    .filter((r) => r.email === email && r.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeShare(
  email: string,
  token: string,
): Promise<void> {
  const all = await readAll();
  const rec = all[token];
  // Owner check — only the owner can revoke their own share.
  if (!rec || rec.email !== email) {
    throw new Error("공유를 찾을 수 없거나 권한이 없습니다.");
  }
  delete all[token];
  await writeAll(all);
}

export async function resolveShare(token: string): Promise<ShareRecord | null> {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const all = await readAll();
  return all[token] ?? null;
}
