import { NextRequest } from "next/server";
import { requireUserOrRespond } from "@/lib/session";
import { makeDir } from "@/lib/fs-browser";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  let body: { parent?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 JSON" }, 400);
  }
  if (typeof body.parent !== "string" || typeof body.name !== "string") {
    return json({ error: "parent + name이 필요합니다." }, 400);
  }
  try {
    const newPath = await makeDir(body.parent, body.name);
    return json({ path: newPath }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
