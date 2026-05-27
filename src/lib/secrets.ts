import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emailToUserId } from "./workspace";

/** Per-user integration secrets, encrypted at rest with AES-256-GCM. */
export type UserSecrets = {
  github?: string;
  vercel?: string;
};

export type SecretKind = "github" | "vercel";

function getSecretsKey(): Buffer {
  const raw =
    process.env.DSCODE_SECRETS_KEY ||
    process.env.AUTH_SECRET ||
    process.env.DSCODE_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "DSCODE_SECRETS_KEY 또는 AUTH_SECRET 환경변수가 필요합니다 (최소 16자).",
    );
  }
  // Derive a 32-byte AES key from the env secret. We don't need a salt here:
  // the env value is the secret. SHA-256 stretches arbitrary-length input to
  // exactly the AES-256 key size.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function usersRoot(): string {
  const fromEnv = process.env.DSCODE_USERS_ROOT;
  const raw = fromEnv || path.join(os.homedir(), ".dscode", "users");
  return path.resolve(raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw);
}

function secretsPath(email: string): string {
  return path.join(usersRoot(), emailToUserId(email), "secrets.json");
}

function encrypt(plaintext: string): string {
  const key = getSecretsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  });
}

function decrypt(serialized: string): string {
  const obj = JSON.parse(serialized) as {
    v: number;
    iv: string;
    tag: string;
    ct: string;
  };
  if (obj.v !== 1) throw new Error("알 수 없는 secrets 포맷 버전");
  const key = getSecretsKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(obj.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(obj.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(obj.ct, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

export async function loadSecrets(email: string): Promise<UserSecrets> {
  try {
    const buf = await fs.readFile(secretsPath(email), "utf8");
    const plaintext = decrypt(buf);
    const parsed = JSON.parse(plaintext) as UserSecrets;
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    // Decrypt/parse failure → treat as empty (logged for ops).
    console.error("[secrets] decrypt failed:", e);
    return {};
  }
}

export async function saveSecret(
  email: string,
  kind: SecretKind,
  token: string,
): Promise<void> {
  const current = await loadSecrets(email);
  current[kind] = token;
  await writeSecrets(email, current);
}

export async function deleteSecret(
  email: string,
  kind: SecretKind,
): Promise<void> {
  const current = await loadSecrets(email);
  delete current[kind];
  await writeSecrets(email, current);
}

async function writeSecrets(email: string, secrets: UserSecrets): Promise<void> {
  const p = secretsPath(email);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, encrypt(JSON.stringify(secrets)), {
    mode: 0o600,
    encoding: "utf8",
  });
}

/** Build a masked preview like "ghp_***wxyz" for the settings UI. */
export function maskToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
