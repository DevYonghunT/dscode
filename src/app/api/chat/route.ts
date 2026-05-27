import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";
import { requireUserAndProject } from "@/lib/session";
import type { Attachment } from "@/lib/client/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function sseFormat(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: {
    prompt?: string;
    attachments?: Attachment[];
    projectId?: string | null;
    newSession?: boolean;
    resumeSessionId?: string;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const auth = await requireUserAndProject(body.projectId ?? null);
  if (auth instanceof Response) return auth;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!prompt && attachments.length === 0) {
    return new Response(JSON.stringify({ error: "prompt 또는 attachments가 필요합니다." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent({
          apiKey,
          workspaceRoot: auth.workspace,
          userEmail: auth.user.email,
          prompt,
          attachments,
          newSession: body.newSession === true,
          resumeSessionId:
            typeof body.resumeSessionId === "string" && body.resumeSessionId
              ? body.resumeSessionId
              : undefined,
          model: body.model || process.env.DSCODE_MODEL,
          signal: abortController.signal,
        })) {
          controller.enqueue(encoder.encode(sseFormat(event)));
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            sseFormat({
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
