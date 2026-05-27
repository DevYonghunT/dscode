import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Attachment, ChatTurn, ToolCallView } from "./client/types";

/**
 * Per-cwd Claude Code session storage layout (host's HOME):
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * Each .jsonl is a stream of events (user/assistant messages, tool calls,
 * queue ops, etc.). We peek into them to surface a "Recent sessions" list
 * and to rehydrate a clicked session back into the chat UI.
 */

/** Encode an absolute path the same way Claude Code does. */
export function encodeCwd(cwd: string): string {
  // Anything that isn't [a-zA-Z0-9-] becomes `-`. Matches what the CLI does
  // (verified against actual on-disk folder names).
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

function sessionsRootForCwd(cwd: string): string {
  return path.join(os.homedir(), ".claude", "projects", encodeCwd(cwd));
}

export type SessionSummary = {
  id: string;
  startedAt: number;
  updatedAt: number;
  bytes: number;
  firstUserMessage: string | null;
};

/** Peek the first ~64KB of a session file for the earliest user-text message. */
async function readFirstUserText(filePath: string): Promise<string | null> {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r");
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.slice(0, bytesRead).toString("utf8");
    const lines = head.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const o = obj as {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      if (o.type !== "user") continue;
      const c = o.message?.content;
      if (typeof c === "string") return c.slice(0, 200);
      if (Array.isArray(c)) {
        for (const block of c) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: string }).text === "string"
          ) {
            return (block as { text: string }).text.slice(0, 200);
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const dir = sessionsRootForCwd(cwd);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    const id = e.name.slice(0, -".jsonl".length);
    const full = path.join(dir, e.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    const firstUserMessage = await readFirstUserText(full);
    out.push({
      id,
      startedAt: stat.birthtimeMs || stat.mtimeMs,
      updatedAt: stat.mtimeMs,
      bytes: stat.size,
      firstUserMessage,
    });
  }
  // Newest first.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full session → ChatTurn[] rehydration (for clicking a session in the sidebar)
// ─────────────────────────────────────────────────────────────────────────────

type AnyObj = Record<string, unknown>;

function asObj(v: unknown): AnyObj | null {
  return v && typeof v === "object" ? (v as AnyObj) : null;
}

function flattenContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const o = asObj(block);
    if (!o) continue;
    if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
  }
  return parts.join("");
}

function extractAttachments(content: unknown, uploadsRel: string[]): Attachment[] {
  if (!Array.isArray(content)) return [];
  const out: Attachment[] = [];
  let imageIdx = 0;
  for (const block of content) {
    const o = asObj(block);
    if (!o) continue;
    if (o.type !== "image") continue;
    // We stored image bytes inside .dscode-uploads/<sha>.<ext> at upload time
    // and replayed them inline into the SDK message. Here we don't easily know
    // which uploaded file matches which inline image block — so we show a
    // placeholder chip per image and (best-effort) match by order if the
    // session's matching `.dscode-uploads/` listing was passed in.
    const path = uploadsRel[imageIdx] || `image-${imageIdx + 1}`;
    const source = asObj(o.source);
    const mime =
      (typeof source?.media_type === "string" ? source.media_type : null) ||
      "image/png";
    out.push({
      kind: "image",
      path,
      name: path.split("/").pop() || `image-${imageIdx + 1}`,
      mime,
      size: 0,
    });
    imageIdx++;
  }
  return out;
}

function newClientId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function* readJsonlLines(buf: string): Generator<AnyObj> {
  for (const raw of buf.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const o = asObj(obj);
    if (o) yield o;
  }
}

/**
 * Load a session's events and turn them into renderable ChatTurns.
 * The .jsonl emits user/assistant messages interleaved with tool_result
 * blocks (themselves carried inside user messages). We:
 *   - drop sidechain / queue-operation / non-message events
 *   - merge consecutive assistant text blocks into one turn
 *   - attach tool_use blocks to the assistant turn they came from
 *   - resolve tool_result content back to its tool_use_id
 */
export async function loadSessionTurns(cwd: string, sessionId: string): Promise<ChatTurn[]> {
  const file = path.join(
    sessionsRootForCwd(cwd),
    `${encodeURIComponent(sessionId)}.jsonl`,
  );
  // The filename on disk is the raw uuid (no encoding) — encodeURIComponent
  // is a no-op for typical uuids but defends against odd ids.
  const realFile = file.includes("%")
    ? path.join(sessionsRootForCwd(cwd), `${sessionId}.jsonl`)
    : file;

  let buf: string;
  try {
    buf = await fs.readFile(realFile, "utf8");
  } catch {
    throw new Error("세션 파일을 찾을 수 없습니다.");
  }

  // Pre-scan the per-cwd uploads directory so we can attribute attachment
  // entries to user turns (best-effort, by order seen).
  let uploadFiles: string[] = [];
  try {
    const u = await fs.readdir(path.join(cwd, ".dscode-uploads"));
    uploadFiles = u
      .map((n) => `.dscode-uploads/${n}`)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    /* ok — no uploads dir */
  }
  let uploadCursor = 0;

  // toolCalls indexed by tool_use_id, owned by their producing assistant turn
  const toolCallById = new Map<string, ToolCallView>();
  const turns: ChatTurn[] = [];
  let currentAssistant: ChatTurn | null = null;

  for (const o of readJsonlLines(buf)) {
    if (o.isSidechain === true) continue; // skip subagent traces
    if (o.type === "user") {
      const msg = asObj(o.message);
      if (!msg) continue;
      const content = msg.content;

      // tool_result blocks come as user messages — they should attach to an
      // existing tool call instead of being shown as a chat bubble.
      if (Array.isArray(content)) {
        let onlyToolResults = true;
        for (const block of content) {
          const b = asObj(block);
          if (!b || b.type !== "tool_result") {
            onlyToolResults = false;
            break;
          }
        }
        if (onlyToolResults && content.length > 0) {
          for (const block of content) {
            const b = asObj(block)!;
            const id = typeof b.tool_use_id === "string" ? b.tool_use_id : null;
            if (!id) continue;
            const tc = toolCallById.get(id);
            if (!tc) continue;
            tc.output = flattenToolResultText(b.content);
            if (b.is_error === true) tc.isError = true;
          }
          // tool_result might co-occur with the next user prompt later; we
          // simply do not create a turn for tool-only user messages.
          // Close any open assistant turn — its tool calls are now resolved.
          if (currentAssistant) {
            currentAssistant.isStreaming = false;
            currentAssistant = null;
          }
          continue;
        }
      }

      // Real user message → close any open assistant turn first.
      if (currentAssistant) {
        currentAssistant.isStreaming = false;
        currentAssistant = null;
      }

      const text = flattenContentToText(content);
      // Pull a few upload chips for image blocks present in this user message.
      const imageCount = Array.isArray(content)
        ? content.filter((b) => asObj(b)?.type === "image").length
        : 0;
      const slice = uploadFiles.slice(uploadCursor, uploadCursor + imageCount);
      uploadCursor += imageCount;
      const attachments = extractAttachments(content, slice);
      turns.push({
        id: newClientId(),
        role: "user",
        text,
        toolCalls: [],
        attachments: attachments.length ? attachments : undefined,
      });
    } else if (o.type === "assistant") {
      const msg = asObj(o.message);
      if (!msg) continue;
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      // Merge into the open assistant turn (or open a new one).
      if (!currentAssistant) {
        currentAssistant = {
          id: newClientId(),
          role: "assistant",
          text: "",
          toolCalls: [],
          isStreaming: false,
        };
        turns.push(currentAssistant);
      }
      for (const block of content) {
        const b = asObj(block);
        if (!b) continue;
        if (b.type === "text" && typeof b.text === "string") {
          currentAssistant.text += b.text;
        } else if (b.type === "tool_use" && typeof b.id === "string") {
          const tc: ToolCallView = {
            id: b.id,
            name: typeof b.name === "string" ? b.name : "tool",
            input: (b.input as Record<string, unknown>) || null,
            startedAt: Date.now(),
          };
          currentAssistant.toolCalls.push(tc);
          toolCallById.set(b.id, tc);
        }
      }
    }
    // ignore: queue-operation, system, result, etc.
  }
  if (currentAssistant) currentAssistant.isStreaming = false;
  return turns;
}

function flattenToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        const o = asObj(c);
        if (!o) return String(c);
        if (o.type === "text" && typeof o.text === "string") return o.text;
        return JSON.stringify(c);
      })
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return String(content ?? "");
}
