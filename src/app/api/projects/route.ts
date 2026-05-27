import { NextRequest } from "next/server";
import { requireUserOrRespond } from "@/lib/session";
import {
  createProject,
  deleteProject,
  listProjects,
} from "@/lib/projects";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET() {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const projects = await listProjects(r.user.email);
  return json({ projects }, 200);
}

export async function POST(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  let body: {
    name?: unknown;
    mode?: unknown;
    path?: unknown;
    gitUrl?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 JSON" }, 400);
  }
  if (typeof body.name !== "string") {
    return json({ error: "name이 필요합니다." }, 400);
  }
  const mode = body.mode;
  if (mode !== "empty" && mode !== "git" && mode !== "external") {
    return json({ error: "mode는 empty/git/external 중 하나여야 합니다." }, 400);
  }
  if (typeof body.path !== "string" || !body.path.trim()) {
    return json({ error: "path가 필요합니다." }, 400);
  }
  const gitUrl = typeof body.gitUrl === "string" ? body.gitUrl.trim() : "";
  try {
    const project = await createProject(r.user.email, body.name, {
      mode,
      path: body.path,
      gitUrl: gitUrl || undefined,
    });
    return json({ project }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

export async function DELETE(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id가 필요합니다." }, 400);
  try {
    await deleteProject(r.user.email, id);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
