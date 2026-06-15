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
      // Google 토큰 엔드포인트는 "데스크톱 앱" 클라이언트라도 client_secret 을 요구한다
      // (없으면 "invalid_request: client_secret is missing" 로 토큰 교환 실패 → 로그인 불가).
      // 설치형 클라이언트의 secret 은 기밀이 아니므로(RFC 8252 §8.5) 빌드에 포함해 전송한다.
      // clientId/clientSecret 은 env(AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)에서 자동 주입,
      // PKCE 는 Google provider 기본값으로 켜진다.
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
