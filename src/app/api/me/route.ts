import { requireUserOrRespond } from "@/lib/session";
import { getUserWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  const r = await requireUserOrRespond();
  if (r instanceof Response) {
    // Not authed: return null session (200) so the client can show login.
    return new Response(JSON.stringify({ user: null, workspace: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const workspace = await getUserWorkspace(r.user.email);
  return new Response(
    JSON.stringify({
      user: r.user,
      workspace,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
