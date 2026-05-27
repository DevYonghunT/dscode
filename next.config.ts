import type { NextConfig } from "next";

const basePath = process.env.DSCODE_BASE_PATH || "/dscode";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
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
