import { NextRequest } from "next/server";
import { requireUserAndProject } from "@/lib/session";
import { loadSessionTurns } from "@/lib/sessions";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;
  if (!/^[a-f0-9-]{8,64}$/i.test(sessionId)) {
    return json({ error: "잘못된 세션 ID" }, 400);
  }
  try {
    const turns = await loadSessionTurns(r.workspace, sessionId);
    return json({ sessionId, turns }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
}
