import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  ".pnpm-store",
  ".DS_Store",
  ".dscode-cli-config",
  ".dscode-uploads",
]);

const MAX_FILES_SCANNED = 5_000;
const MAX_NAME_RESULTS = 30;
const MAX_CONTENT_RESULTS = 60;
const MAX_CONTENT_BYTES = 1_000_000; // skip very large files for content match
const BINARY_SAMPLE = 4_096; // bytes to peek for binary detection

type NameHit = { kind: "name"; path: string; type: "dir" | "file" };
type ContentHit = {
  kind: "content";
  path: string;
  line: number;
  text: string;
};

function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SAMPLE);
  let nullBytes = 0;
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) nullBytes++;
  }
  // >1% null bytes ≈ binary
  return nullBytes > len * 0.01;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = await requireUserAndProject(url.searchParams.get("projectId"));
  if (r instanceof Response) return r;

  const workspace = r.workspace;
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ nameHits: [], contentHits: [] }, 200);

  // Build a case-insensitive regex; escape user input.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");

  const nameHits: NameHit[] = [];
  const contentHits: ContentHit[] = [];
  let scanned = 0;

  async function walk(dir: string): Promise<void> {
    if (scanned >= MAX_FILES_SCANNED) return;
    if (
      nameHits.length >= MAX_NAME_RESULTS &&
      contentHits.length >= MAX_CONTENT_RESULTS
    )
      return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(workspace, full);

      // Name match — on every entry, dirs included.
      if (nameHits.length < MAX_NAME_RESULTS && re.test(rel)) {
        nameHits.push({
          kind: "name",
          path: rel,
          type: e.isDirectory() ? "dir" : "file",
        });
      }

      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && contentHits.length < MAX_CONTENT_RESULTS) {
        scanned++;
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_CONTENT_BYTES) continue;
          const buf = await fs.readFile(full);
          if (isProbablyBinary(buf)) continue;
          const text = buf.toString("utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              contentHits.push({
                kind: "content",
                path: rel,
                line: i + 1,
                text: lines[i].slice(0, 240),
              });
              if (contentHits.length >= MAX_CONTENT_RESULTS) break;
            }
          }
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }

  try {
    await walk(workspace);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({ nameHits, contentHits, scanned }, 200);
}
