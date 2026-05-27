import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUserAndProject } from "@/lib/session";
import { safeResolve } from "@/lib/workspace";

export const runtime = "nodejs";

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
]);

type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
};

async function buildTree(
  absRoot: string,
  dir: string,
  depth: number,
  maxDepth: number,
): Promise<TreeNode[]> {
  if (depth > maxDepth) return [];
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith(".") && e.name !== ".env.example") continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(absRoot, full);
    if (e.isDirectory()) {
      const children = await buildTree(absRoot, full, depth + 1, maxDepth);
      nodes.push({ name: e.name, path: rel, type: "dir", children });
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: rel, type: "file" });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const r = await requireUserAndProject(projectId);
  if (r instanceof Response) return r;
  try {
    const subpath = url.searchParams.get("path") || ".";
    const depthParam = url.searchParams.get("depth");
    const maxDepth = depthParam
      ? Math.min(6, Math.max(1, parseInt(depthParam, 10)))
      : 3;
    const start = safeResolve(r.workspace, subpath);
    const tree = await buildTree(r.workspace, start, 0, maxDepth);
    return new Response(
      JSON.stringify({ projectId: r.projectId, root: r.workspace, tree }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
}
