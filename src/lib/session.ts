import { auth, isEmailAllowed } from "@/auth";
import { getUserWorkspace } from "./workspace";
import { DEFAULT_PROJECT_ID, getProjectRoot } from "./projects";

export type AuthedUser = {
  email: string;
  name?: string | null;
  image?: string | null;
};

/**
 * Require an authenticated, domain-allowed user. Returns either the user or a
 * Response (401) that the route handler should bail with.
 */
export async function requireUserOrRespond(): Promise<{ user: AuthedUser } | Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isEmailAllowed(email)) {
    return new Response(JSON.stringify({ error: "로그인이 필요합니다." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return {
    user: {
      email,
      name: session.user?.name,
      image: session.user?.image,
    },
  };
}

/**
 * Convenience: require auth, then resolve the user's default workspace path.
 */
export async function requireUserAndWorkspace(): Promise<
  { user: AuthedUser; workspace: string } | Response
> {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const workspace = await getUserWorkspace(r.user.email);
  return { user: r.user, workspace };
}

/**
 * Require auth and resolve the cwd for a specific project (default if not given).
 * Used by routes that operate inside a chosen project.
 */
export async function requireUserAndProject(
  projectId: string | null | undefined,
): Promise<{ user: AuthedUser; workspace: string; projectId: string } | Response> {
  const r = await requireUserOrRespond();
  if (r instanceof Response) return r;
  const pid = projectId && projectId.length > 0 ? projectId : DEFAULT_PROJECT_ID;
  try {
    const workspace = await getProjectRoot(r.user.email, pid);
    return { user: r.user, workspace, projectId: pid };
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
}
