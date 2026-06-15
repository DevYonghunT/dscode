import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_DOMAIN = process.env.DSCODE_ALLOWED_DOMAIN || "duksoo.hs.kr";
const ADMIN_OVERRIDE_EMAILS = (process.env.DSCODE_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const BASE_PATH = process.env.DSCODE_BASE_PATH || "/dscode";

function emailAllowed(email: string | undefined | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ADMIN_OVERRIDE_EMAILS.includes(lower)) return true;
  return lower.endsWith(`@${ALLOWED_DOMAIN}`);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // NextAuth needs to see the FULL public path (/dscode/api/auth) so its
  // internal redirect_uri matches what Google sees in the browser. Next.js
  // strips /dscode before routing to the handler, so the catchall route
  // re-prepends it before invoking these handlers (see api/auth/[...nextauth]/route.ts).
  basePath: `${BASE_PATH}/api/auth`,
  trustHost: true,
  providers: [
    Google({
      // 프로덕션은 Google "데스크톱 앱"(공개) 클라이언트라 client_secret 이 없다.
      // secret 이 없으면 토큰 교환 시 클라이언트 인증을 보내지 않고(none) PKCE 로만
      // 검증한다. secret 이 없는데 이 설정이 없으면 Auth.js 기본값(client_secret_basic)
      // 으로 빈 secret 을 보내 Google 이 "invalid_client" 로 거부한다.
      // (secret 이 있으면 — dev 웹 클라이언트 — 기본 동작 유지)
      ...(process.env.AUTH_GOOGLE_SECRET
        ? {}
        : {
            client: { token_endpoint_auth_method: "none" },
            checks: ["pkce", "state", "nonce"] as ("pkce" | "state" | "nonce")[],
          }),
      authorization: {
        params: {
          hd: ALLOWED_DOMAIN,
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      if (verified !== true) return false;
      return emailAllowed(profile?.email);
    },
    async jwt({ token, profile, account }) {
      if (profile?.email) token.email = profile.email;
      const picture = (profile as { picture?: string } | undefined)?.picture;
      if (picture) token.picture = picture;
      // Google id_token 저장 — agentclass issue-token 검증용 (로그인 시점에만 account 존재)
      if (account?.id_token) token.googleIdToken = account.id_token;
      return token;
    },
    async session({ session, token }) {
      if (token.email) session.user = { ...session.user, email: token.email as string };
      if (token.picture && session.user) session.user.image = token.picture as string;
      (session as { googleIdToken?: string }).googleIdToken = token.googleIdToken as string | undefined;
      return session;
    },
    async redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        if (u.origin === baseUrl) {
          if (u.pathname === "/" || u.pathname === "") {
            return `${baseUrl}${BASE_PATH}/`;
          }
          return u.toString();
        }
      } catch {
        /* ignore */
      }
      return `${baseUrl}${BASE_PATH}/`;
    },
  },
  pages: {
    signIn: `${BASE_PATH}/`,
    error: `${BASE_PATH}/`,
    signOut: `${BASE_PATH}/`,
  },
  session: { strategy: "jwt" },
});

export function isEmailAllowed(email: string | undefined | null): boolean {
  return emailAllowed(email);
}
