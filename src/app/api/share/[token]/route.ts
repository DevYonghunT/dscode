import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveShare } from "@/lib/shares";
import { getProjectRoot, listProjects } from "@/lib/projects";

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
  ".dscode-uploads",
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
  let entries: import("node:fs").Dirent[];
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const share = await resolveShare(token);
  if (!share) return json({ error: "공유 링크가 유효하지 않습니다." }, 404);
  let root: string;
  try {
    root = await getProjectRoot(share.email, share.projectId);
  } catch {
    return json({ error: "프로젝트를 찾을 수 없습니다." }, 404);
  }
  // Find the project's friendly name from the owner's manifest.
  let projectName = share.projectId;
  try {
    const projects = await listProjects(share.email);
    const found = projects.find((p) => p.id === share.projectId);
    if (found) projectName = found.name;
  } catch {
    /* ignore */
  }
  const tree = await buildTree(root, root, 0, 3);
  return json(
    {
      projectName,
      tree,
      createdAt: share.createdAt,
      ownerInitial: share.email.slice(0, 1).toUpperCase(),
    },
    200,
  );
}
