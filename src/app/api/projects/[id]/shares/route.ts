import { NextRequest } from "next/server";
import { requireUserAndProject } from "@/lib/session";
import {
  createShare,
  listSharesForProject,
  revokeShare,
} from "@/lib/shares";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;
  const shares = await listSharesForProject(r.user.email, id);
  return json({ shares }, 200);
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;
  const share = await createShare(r.user.email, id);
  return json({ share }, 200);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "token이 필요합니다." }, 400);
  try {
    await revokeShare(r.user.email, token);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
