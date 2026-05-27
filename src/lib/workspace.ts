import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function getUsersRoot(): string {
  const fromEnv = process.env.DSCODE_USERS_ROOT;
  const raw = fromEnv || path.join(os.homedir(), ".dscode", "users");
  return path.resolve(expandHome(raw));
}

/**
 * Sanitize an email into a stable filesystem-safe identifier.
 * - Lowercased
 * - Local part kept (limited to [a-z0-9._-])
 * - Domain part appended after `__` to keep different domains separate.
 *
 * Examples:
 *   kim.yonghun@duksoo.hs.kr  →  kim.yonghun__duksoo.hs.kr
 *   foo+bar@example.com       →  foobar__example.com  (plus sign stripped)
 */
export function emailToUserId(email: string): string {
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf("@");
  if (at <= 0 || at === lower.length - 1) {
    throw new Error(`잘못된 이메일: ${email}`);
  }
  const local = lower.slice(0, at).replace(/[^a-z0-9._-]/g, "");
  const domain = lower.slice(at + 1).replace(/[^a-z0-9._-]/g, "");
  if (!local || !domain) throw new Error(`잘못된 이메일: ${email}`);
  return `${local}__${domain}`;
}

/**
 * Resolve (and lazily create) the persistent workspace directory for a given
 * user email. The same email always maps to the same directory — so the user
 * keeps their files and their .claude/ session history across logins.
 */
export async function getUserWorkspace(email: string): Promise<string> {
  const id = emailToUserId(email);
  const root = path.join(getUsersRoot(), id, "workspace");
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Delete every file under a user's workspace (used by the "Reset" button).
 * Preserves the workspace dir itself so the user can keep using it.
 */
export async function resetUserWorkspace(email: string): Promise<string> {
  const root = await getUserWorkspace(email);
  const entries = await fs.readdir(root);
  await Promise.all(
    entries.map((name) => fs.rm(path.join(root, name), { recursive: true, force: true })),
  );
  return root;
}

/**
 * Resolve a path relative to a workspace root, refusing any escape attempt.
 */
export function safeResolve(root: string, relOrAbs: string): string {
  const candidate = path.isAbsolute(relOrAbs)
    ? path.resolve(relOrAbs)
    : path.resolve(root, relOrAbs);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`경로가 워크스페이스 밖입니다: ${relOrAbs}`);
  }
  return candidate;
}

export function usersRoot(): string {
  return getUsersRoot();
}
