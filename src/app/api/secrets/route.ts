import { NextRequest } from "next/server";
import { requireUserOrRespond } from "@/lib/session";
import {
  deleteSecret,
  loadSecrets,
  maskToken,
  saveSecret,
  type SecretKind,
} from "@/lib/secrets";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isKind(v: unknown): v is SecretKind {
  return v === "github" || v === "vercel";
}

export async function GET() {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const s = await loadSecrets(r.user.email);
  return json(
    {
      github: s.github ? { connected: true, masked: maskToken(s.github) } : null,
      vercel: s.vercel ? { connected: true, masked: maskToken(s.vercel) } : null,
    },
    200,
  );
}

export async function POST(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  let body: { kind?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 JSON" }, 400);
  }
  if (!isKind(body.kind)) return json({ error: "kind는 github 또는 vercel" }, 400);
  if (typeof body.token !== "string" || body.token.trim().length < 8) {
    return json({ error: "유효한 token이 필요합니다." }, 400);
  }
  try {
    await saveSecret(r.user.email, body.kind, body.token.trim());
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!isKind(kind)) return json({ error: "kind는 github 또는 vercel" }, 400);
  try {
    await deleteSecret(r.user.email, kind);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
