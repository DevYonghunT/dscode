import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = await requireUserAndProject(url.searchParams.get("projectId"));
  if (r instanceof Response) return r;
  return json(
    { workspace: { root: r.workspace, projectId: r.projectId } },
    200,
  );
}

/** Reset (empty) the workspace of the given project (default if none given). */
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const r = await requireUserAndProject(url.searchParams.get("projectId"));
  if (r instanceof Response) return r;
  try {
    const entries = await fs.readdir(r.workspace);
    await Promise.all(
      entries.map((name) =>
        fs.rm(path.join(r.workspace, name), { recursive: true, force: true }),
      ),
    );
    return json(
      { workspace: { root: r.workspace, projectId: r.projectId } },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
