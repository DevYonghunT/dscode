import type { NextConfig } from "next";

const basePath = process.env.DSCODE_BASE_PATH || "/dscode";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // Next.js 16 은 dev 에서 cross-origin HMR 요청을 기본 차단한다.
  // Electron BrowserWindow 는 127.0.0.1 로 접속하므로 명시 허용 필요.
  // (localhost 도 포함해서 일반 브라우저 접근도 같이 허용)
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Claude Agent SDK ships a native `claude` CLI binary as a platform-specific
  // subpackage and resolves it at runtime. Bundling it confuses Turbopack's
  // module resolution, so we mark these as external for server bundles.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    "@anthropic-ai/claude-agent-sdk-darwin-x64",
    "@anthropic-ai/claude-agent-sdk-linux-x64",
    "@anthropic-ai/claude-agent-sdk-linux-arm64",
    "@anthropic-ai/claude-agent-sdk-win32-x64",
  ],
};

export default nextConfig;
