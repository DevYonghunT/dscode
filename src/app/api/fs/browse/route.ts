import { NextRequest } from "next/server";
import { requireUserOrRespond } from "@/lib/session";
import { browseDir } from "@/lib/fs-browser";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const url = new URL(req.url);
  const requestedPath = url.searchParams.get("path") || undefined;
  try {
    const result = await browseDir(requestedPath);
    return json(result, 200);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      400,
    );
  }
}
