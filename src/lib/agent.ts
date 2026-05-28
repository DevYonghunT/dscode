import fs from "node:fs/promises";
import path from "node:path";
import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Attachment } from "@/lib/client/types";
import { loadSecrets } from "@/lib/secrets";

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input"; id: string; input: Record<string, unknown> }
  | { type: "tool_use_result"; id: string; output: string; is_error?: boolean }
  | { type: "turn_complete"; stop_reason: string | null }
  | { type: "done" }
  | { type: "error"; message: string };

export type RunAgentOptions = {
  apiKey: string;
  workspaceRoot: string;
  /** User's email; used for git author + secrets lookup. */
  userEmail: string;
  prompt: string;
  attachments?: Attachment[];
  /** Start a fresh conversation thread in this cwd instead of resuming the last one. */
  newSession?: boolean;
  /** Resume a specific past session UUID instead of the cwd's "last". */
  resumeSessionId?: string;
  model?: string;
  signal?: AbortSignal;
};

const SYSTEM_APPEND_BASE = `당신은 Duksoo Code (DS Code)의 코딩 에이전트입니다.

작업 원칙:
- 한국어로 응답합니다. 코드 주석은 사용자가 쓰는 언어를 따릅니다.
- 작업 전에 Read/Glob/Grep으로 컨텍스트를 먼저 파악합니다.
- 파일 수정은 Edit을 우선 사용하고, 새 파일이나 전체 재작성에만 Write를 씁니다.
- 응답은 간결하게. 변경한 내용과 그 이유만 짧게 요약합니다.
- 작업 후 빌드/타입체크/테스트가 적절하면 Bash로 실행해 결과를 확인합니다.
- 최신 정보·외부 문서가 필요할 땐 WebSearch를 먼저, 특정 URL이 있으면 WebFetch를 쓰세요.

첨부 파일 처리:
- 사용자가 \`.dscode-uploads/\`에 파일을 첨부할 수 있습니다.
- 이미지는 메시지에 직접 포함되어 보입니다.
- 텍스트/PDF/JSON 등 비이미지 파일은 워크스페이스에 저장되어 있으니 Read 도구로 직접 읽어서 처리하세요.`;

const SYSTEM_APPEND_GITHUB = `

GitHub 연동:
- \`gh\` CLI가 이미 GH_TOKEN으로 인증돼 있습니다. \`gh repo create\`, \`gh pr create\` 등을 바로 쓰세요.
- \`git push\`도 자동 인증됩니다. **토큰을 origin URL에 박지 마세요** (보안). 그냥 \`git push\`만 쓰면 됩니다.
- 새 레포 만들 때 기본 가시성은 private, 사용자가 public을 명시하면 public.`;

const SYSTEM_APPEND_VERCEL = `

Vercel 배포:
- \`vercel\` CLI가 이미 VERCEL_TOKEN으로 인증돼 있습니다.
- 첫 배포 전: \`vercel link --yes\` 로 프로젝트 연결.
- 프리뷰 배포: \`vercel --yes\`. 운영 배포: \`vercel --prod --yes\`.
- 배포 후 출력된 https URL을 사용자에게 안내하세요.`;

function flattenToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const o = c as { type?: string; text?: string };
          if (o.type === "text" && typeof o.text === "string") return o.text;
          return JSON.stringify(c);
        }
        return String(c);
      })
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return String(content ?? "");
}

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
        data: string;
      };
    };

async function buildMultimodalMessage(
  workspaceRoot: string,
  prompt: string,
  attachments: Attachment[],
): Promise<SDKUserMessage> {
  const images = attachments.filter((a) => a.kind === "image");
  const texts = attachments.filter((a) => a.kind === "text");

  let promptText = prompt;
  if (texts.length > 0) {
    const lines = texts.map(
      (t) =>
        `  - ${t.path}  (원본 파일명: ${t.name}, ${t.mime}, ${(t.size / 1024).toFixed(1)}KB)`,
    );
    promptText +=
      `\n\n[사용자가 첨부한 파일 — 워크스페이스 기준 상대경로]\n` +
      lines.join("\n") +
      `\n\n위 파일들은 Read 도구로 직접 읽을 수 있습니다.`;
  }

  const content: ContentBlock[] = [];
  if (promptText) content.push({ type: "text", text: promptText });
  for (const img of images) {
    const abs = path.join(workspaceRoot, img.path);
    const buf = await fs.readFile(abs);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mime as
          | "image/png"
          | "image/jpeg"
          | "image/webp"
          | "image/gif",
        data: buf.toString("base64"),
      },
    });
  }

  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      // The SDK forwards this MessageParam straight to the Anthropic API,
      // which accepts our ContentBlock[] shape (text + image blocks).
      content: content as unknown as SDKUserMessage["message"]["content"],
    },
  };
}

export async function* runAgent(
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent, void, void> {
  const {
    apiKey,
    workspaceRoot,
    userEmail,
    prompt,
    attachments,
    newSession,
    resumeSessionId,
    model,
    signal,
  } = opts;

  // Per-user integration tokens (GitHub PAT, Vercel token, etc.) — encrypted
  // at rest, loaded once per chat invocation.
  const userSecrets = await loadSecrets(userEmail);
  const emailLocal = userEmail.split("@")[0] || "user";

  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener("abort", () => abortController.abort());
  }

  // The SDK spawns the Claude Code CLI as a subprocess. On macOS the CLI will
  // happily reach into the user's Keychain for OAuth credentials if any auth
  // env var is missing or ambiguous. For a multi-user server we want STRICT
  // API-key-only auth, so we construct a minimal child env and aim it at an
  // isolated CLI config directory.
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME || "/tmp",
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: "dumb",
    ANTHROPIC_API_KEY: apiKey,
    // Force the CLI to use API-key auth: isolated config dir, no OAuth tokens,
    // no Bedrock/Vertex hijacking.
    ANTHROPIC_CONFIG_DIR: `${workspaceRoot}/.dscode-cli-config`,
    // Optional school-proxy endpoint. When set, the CLI talks to the proxy
    // (which injects the real API key server-side) instead of api.anthropic.com.
    ...(process.env.ANTHROPIC_BASE_URL
      ? { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL }
      : {}),
    CLAUDE_CODE_SKIP_BEDROCK_AUTH: "1",
    CLAUDE_CODE_SKIP_VERTEX_AUTH: "1",
    CLAUDE_CODE_SKIP_FOUNDRY_AUTH: "1",
    CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH: "1",
    CLAUDE_CODE_SKIP_MANTLE_AUTH: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    // Git author identity for commits made by the agent in this user's name.
    GIT_AUTHOR_NAME: emailLocal,
    GIT_AUTHOR_EMAIL: userEmail,
    GIT_COMMITTER_NAME: emailLocal,
    GIT_COMMITTER_EMAIL: userEmail,
  };
  if (userSecrets.github) {
    childEnv.GH_TOKEN = userSecrets.github;
    childEnv.GITHUB_TOKEN = userSecrets.github;
  }
  if (userSecrets.vercel) {
    childEnv.VERCEL_TOKEN = userSecrets.vercel;
  }

  // Compose system prompt with conditional hints based on what's wired up.
  let systemAppend = SYSTEM_APPEND_BASE;
  if (userSecrets.github) systemAppend += SYSTEM_APPEND_GITHUB;
  if (userSecrets.vercel) systemAppend += SYSTEM_APPEND_VERCEL;

  const options: Options = {
    cwd: workspaceRoot,
    abortController,
    includePartialMessages: true,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Session selection:
    //  - resumeSessionId set  → resume that specific past session
    //  - newSession set       → start fresh, ignore the cwd's last session
    //  - otherwise (default)  → continue the most recent session in this cwd
    continue: !newSession && !resumeSessionId,
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    maxTurns: 30,
    env: childEnv,
    // SDK isolation mode: do NOT inherit the host's ~/.claude config, hooks,
    // plugins, or CLAUDE.md. Critical for a multi-user server so admin-local
    // skills/hooks don't leak into user sessions.
    settingSources: [],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemAppend,
    },
  };
  if (model) options.model = model;

  // Build either a plain string prompt (fast path) or an AsyncIterable carrying
  // a single multimodal user message when there are image attachments.
  const hasAttachments = attachments && attachments.length > 0;
  let queryPrompt: string | AsyncIterable<SDKUserMessage>;
  if (hasAttachments) {
    const userMsg = await buildMultimodalMessage(
      workspaceRoot,
      prompt,
      attachments!,
    );
    queryPrompt = (async function* () {
      yield userMsg;
    })();
  } else {
    queryPrompt = prompt;
  }

  try {
    const stream = query({ prompt: queryPrompt, options });

    let emittedSessionId: string | null = null;
    for await (const msg of stream) {
      if (signal?.aborted) {
        yield { type: "error", message: "중단됨" };
        return;
      }

      // Almost every SDK message carries `session_id`. Emit the first one we
      // see (and any change) so the client can pin the current session ID,
      // which it didn't know up-front for newly-started sessions.
      const sid = (msg as { session_id?: unknown }).session_id;
      if (typeof sid === "string" && sid && sid !== emittedSessionId) {
        emittedSessionId = sid;
        yield { type: "session", sessionId: sid };
      }

      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev.type === "content_block_start") {
          const block = ev.content_block as { type: string; id?: string; name?: string };
          if (block.type === "tool_use" && block.id && block.name) {
            yield { type: "tool_use_start", id: block.id, name: block.name };
          }
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta as { type: string; text?: string };
          if (d.type === "text_delta" && typeof d.text === "string") {
            yield { type: "text_delta", text: d.text };
          }
        }
      } else if (msg.type === "assistant") {
        // Emit fully-parsed tool_use inputs.
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_use_input",
              id: block.id,
              input: block.input as Record<string, unknown>,
            };
          }
        }
      } else if (msg.type === "user") {
        // tool_result blocks come back as user messages.
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block &&
              typeof block === "object" &&
              "type" in block &&
              (block as { type: string }).type === "tool_result"
            ) {
              const tr = block as {
                tool_use_id: string;
                content?: unknown;
                is_error?: boolean;
              };
              yield {
                type: "tool_use_result",
                id: tr.tool_use_id,
                output: flattenToolResultContent(tr.content),
                is_error: tr.is_error,
              };
            }
          }
        }
      } else if (msg.type === "result") {
        // Note: result.subtype can be "success" while is_error is true
        // (e.g. an upstream 401 surfaces as a synthetic message). Treat any
        // is_error result as an error so the UI shows it.
        if (msg.subtype === "success" && !msg.is_error) {
          yield { type: "turn_complete", stop_reason: msg.stop_reason };
          yield { type: "done" };
          return;
        }
        const errMsg =
          ("result" in msg && typeof msg.result === "string" && msg.result) ||
          ("errors" in msg && Array.isArray(msg.errors) && msg.errors.join("\n")) ||
          `에이전트 오류: ${msg.subtype}`;
        yield { type: "error", message: errMsg };
        return;
      }
    }

    yield { type: "done" };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      yield { type: "error", message: "중단됨" };
    } else {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}
