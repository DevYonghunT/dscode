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
  try {
    const raw = await fs.readFile(sharesPath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, ShareRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAll(all: Record<string, ShareRecord>): Promise<void> {
  const p = sharesPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(all, null, 2), {
    mode: 0o600,
    encoding: "utf8",
  });
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
