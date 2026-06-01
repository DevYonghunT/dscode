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
  // Claude Agent SDK 의 메인 패키지는 bundle 에 포함 — Turbopack 의 production
  // build 가 external 패키지를 hash-suffix 된 이름으로 import 시도하다 깨지는
  // ESM resolution bug 회피 (Cannot find package '...-7f441151e4941530').
  // Platform-specific native binary subpackage 만 external 로 둬서, runtime 에서
  // 현재 OS 의 .node 파일을 spawn 가능하게 한다.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    "@anthropic-ai/claude-agent-sdk-darwin-x64",
    "@anthropic-ai/claude-agent-sdk-linux-x64",
    "@anthropic-ai/claude-agent-sdk-linux-arm64",
    "@anthropic-ai/claude-agent-sdk-win32-x64",
  ],
};

export default nextConfig;
