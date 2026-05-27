import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { requireUserAndProject } from "@/lib/session";
import { safeResolve } from "@/lib/workspace";
import type { Attachment } from "@/lib/client/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_SUBDIR = ".dscode-uploads";

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/pdf",
  "application/zip",
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic image limit
const MAX_TEXT_BYTES = 10 * 1024 * 1024; // sensible cap for text/PDF

function classify(mime: string): "image" | "text" | null {
  if (IMAGE_MIMES.has(mime)) return "image";
  if (mime.startsWith("text/")) return "text";
  if (TEXT_MIMES.has(mime)) return "text";
  return null;
}

function extFor(name: string, mime: string): string {
  const fromName = path.extname(name).toLowerCase();
  if (fromName) return fromName;
  // Fallback to MIME-derived extension.
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/json") return ".json";
  if (mime === "application/pdf") return ".pdf";
  if (mime === "application/zip") return ".zip";
  if (mime.startsWith("text/")) return ".txt";
  return "";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "잘못된 form-data 요청" }, 400);
  }
  const projectId =
    typeof form.get("projectId") === "string"
      ? (form.get("projectId") as string)
      : null;
  const auth = await requireUserAndProject(projectId);
  if (auth instanceof Response) return auth;

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return json({ error: "files 필드에 파일이 없습니다." }, 400);
  }

  const uploadsDir = safeResolve(auth.workspace, UPLOAD_SUBDIR);
  await fs.mkdir(uploadsDir, { recursive: true });

  const results: Attachment[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const file of files) {
    try {
      const kind = classify(file.type);
      if (!kind) {
        errors.push({ name: file.name, error: `지원하지 않는 형식: ${file.type || "unknown"}` });
        continue;
      }
      const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
      if (file.size > max) {
        errors.push({
          name: file.name,
          error: `용량 초과 (${(file.size / 1024 / 1024).toFixed(1)}MB > ${max / 1024 / 1024}MB)`,
        });
        continue;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
      const ext = extFor(file.name, file.type);
      const stored = `${sha}${ext}`;
      const absPath = path.join(uploadsDir, stored);
      // Skip rewrite if same content already exists (saves disk + bandwidth).
      try {
        await fs.access(absPath);
      } catch {
        await fs.writeFile(absPath, buf, { mode: 0o600 });
      }
      results.push({
        kind,
        path: `${UPLOAD_SUBDIR}/${stored}`,
        name: file.name,
        mime: file.type,
        size: file.size,
      });
    } catch (e) {
      errors.push({
        name: file.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return json({ attachments: results, errors }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
