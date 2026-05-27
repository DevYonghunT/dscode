import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { resolveShare } from "@/lib/shares";
import { getProjectRoot } from "@/lib/projects";
import { safeResolve } from "@/lib/workspace";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const share = await resolveShare(token);
  if (!share) return json({ error: "공유 링크가 유효하지 않습니다." }, 404);
  let root: string;
  try {
    root = await getProjectRoot(share.email, share.projectId);
  } catch {
    return json({ error: "프로젝트를 찾을 수 없습니다." }, 404);
  }
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel) return json({ error: "path 파라미터가 필요합니다." }, 400);
  try {
    const full = safeResolve(root, rel);
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
    return json({ path: rel, size: stat.size, truncated: false, content }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
