import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";
import { DEFAULT_PROJECT_ID } from "@/lib/projects";

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

  // 기본(managed) 워크스페이스만 비울 수 있다. default 외의 모든 프로젝트는
  // 사용자가 직접 고른 실제 폴더(externalPath)를 root 로 가지므로(projects.ts:313
  // createProject 가 empty/git/external 모든 모드에 externalPath 를 기록), 여기서
  // rm 하면 학생의 실제 레포(.git 포함)가 통째로 삭제된다. 그런 폴더의 정리는
  // "프로젝트 삭제"(deleteProject, external 은 unlink-only)로만 처리한다.
  if (r.projectId !== DEFAULT_PROJECT_ID) {
    return json(
      {
        error:
          "연결된 폴더 프로젝트는 워크스페이스를 비울 수 없습니다. 실제 파일을 지우지 않으려면 프로젝트 삭제를 사용하세요.",
      },
      403,
    );
  }
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
