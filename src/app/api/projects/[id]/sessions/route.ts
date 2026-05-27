import { NextRequest } from "next/server";
import { requireUserAndProject } from "@/lib/session";
import { listSessions } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;
  const sessions = await listSessions(r.workspace);
  return new Response(JSON.stringify({ sessions }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
