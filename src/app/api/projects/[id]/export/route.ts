import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonErr(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stream the project's workspace as a zip archive.
 *
 * We shell out to the system `zip` so we don't pull a heavy npm dep for an
 * occasional download. `-r` recurses, `-x` excludes our hidden CLI config and
 * the per-user encrypted secrets dir.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await requireUserAndProject(id);
  if (r instanceof Response) return r;

  const parent = path.dirname(r.workspace);
  const folder = path.basename(r.workspace);

  let child;
  try {
    child = spawn(
      "zip",
      [
        "-r",
        "-q", // quiet — keep stderr clean
        "-",
        folder,
        // Skip noise that shouldn't be in user downloads.
        "-x",
        `${folder}/.dscode-cli-config/*`,
        `${folder}/.dscode-uploads/*`,
        `${folder}/.git/objects/pack/*`, // pack files can be huge
        `${folder}/node_modules/*`,
      ],
      { cwd: parent },
    );
  } catch (e) {
    return jsonErr(
      `zip 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
      500,
    );
  }

  const errChunks: Buffer[] = [];
  child.stderr.on("data", (d: Buffer) => errChunks.push(d));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (d: Buffer) => {
        controller.enqueue(new Uint8Array(d));
      });
      child.stdout.on("end", () => controller.close());
      child.on("error", (e) => controller.error(e));
      child.on("close", (code) => {
        // `zip` exits 12 when there's "nothing to do" — treat as success-with-empty.
        if (code !== 0 && code !== 12) {
          const msg = Buffer.concat(errChunks).toString("utf8").trim();
          try {
            controller.error(
              new Error(`zip 종료 코드 ${code}${msg ? `: ${msg}` : ""}`),
            );
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  const safeName = (folder || "project").replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeName}.zip"`,
      "cache-control": "no-store",
    },
  });
}
