import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";
import { safeResolve } from "@/lib/workspace";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024; // 512KB
const MAX_WRITE_BYTES = 5 * 1024 * 1024; // 5MB for editor-saved content

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = await requireUserAndProject(url.searchParams.get("projectId"));
  if (r instanceof Response) return r;
  try {
    const rel = url.searchParams.get("path");
    if (!rel) return json({ error: "path 파라미터가 필요합니다." }, 400);
    const full = safeResolve(r.workspace, rel);
    const stat = await fs.stat(full);
    if (!stat.isFile()) return json({ error: "파일이 아닙니다." }, 400);
    if (stat.size > MAX_BYTES) {
      const fh = await fs.open(full, "r");
      try {
        const buf = Buffer.alloc(MAX_BYTES);
        await fh.read(buf, 0, MAX_BYTES, 0);
        return json(
          {
            path: rel,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            truncated: true,
            content: buf.toString("utf8"),
          },
          200,
        );
      } finally {
        await fh.close();
      }
    }
    const content = await fs.readFile(full, "utf8");
    return json(
      {
        path: rel,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        truncated: false,
        content,
      },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

/**
 * Save a file from the in-browser editor.
 * Body: { path, content, mtimeMs?, truncated?, projectId? }
 *  - If `mtimeMs` is given, we 409 when the on-disk mtime is newer (i.e. the
 *    file was modified externally — usually by the agent — while the user was
 *    editing). The client should reload and retry.
 *  - If `truncated` is true, the client only loaded the first 512KB of a large
 *    file (see GET). Saving it would overwrite the whole file with the truncated
 *    content and permanently destroy the rest — so we refuse the write.
 */
export async function PUT(req: NextRequest) {
  let body: {
    path?: string;
    content?: string;
    mtimeMs?: number;
    truncated?: boolean;
    projectId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 JSON" }, 400);
  }
  const r = await requireUserAndProject(body.projectId ?? null);
  if (r instanceof Response) return r;
  if (typeof body.path !== "string" || !body.path) {
    return json({ error: "path가 필요합니다." }, 400);
  }
  if (typeof body.content !== "string") {
    return json({ error: "content가 필요합니다." }, 400);
  }
  // 일부만 로드된(truncated) 파일은 저장 거부 — 잘린 내용으로 원본 전체를 덮어쓰는 것을 막는다.
  if (body.truncated === true) {
    return json(
      {
        error:
          "파일이 너무 커서 일부만 표시됩니다. 안전을 위해 저장할 수 없어요.",
        code: "truncated",
      },
      409,
    );
  }
  const contentBytes = Buffer.byteLength(body.content, "utf8");
  if (contentBytes > MAX_WRITE_BYTES) {
    return json(
      {
        error: `파일이 너무 큽니다 (${(contentBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_WRITE_BYTES / 1024 / 1024}MB)`,
      },
      400,
    );
  }
  try {
    const full = safeResolve(r.workspace, body.path);
    if (typeof body.mtimeMs === "number") {
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs > body.mtimeMs + 1) {
          return json(
            {
              error: "외부에서 파일이 변경되었습니다. 새로고침 후 다시 저장해주세요.",
              code: "conflict",
              currentMtimeMs: stat.mtimeMs,
            },
            409,
          );
        }
      } catch {
        /* file missing → treat as new file */
      }
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body.content, "utf8");
    const stat = await fs.stat(full);
    return json(
      {
        path: body.path,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
