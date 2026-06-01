"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, AlertCircle, Copy, Check } from "lucide-react";
import type { ChatTurn } from "@/lib/client/types";
import { ToolCallCard } from "./ToolCallView";
import { Emblem } from "./Emblem";
import { AttachmentChip } from "./AttachmentChip";

type Props = {
  turn: ChatTurn;
  /** Click handler for file paths surfaced in tool cards + inline code. */
  onFilePathClick?: (path: string) => void;
};

// Looks like a file path: at least one slash OR a recognizable extension.
const FILE_PATH_RE =
  /^(?:\.{1,2}\/)?[\w.\-]+(?:\/[\w.\-]+)*\.[a-zA-Z0-9]{1,8}$/;

function looksLikeFilePath(s: string): boolean {
  if (!s) return false;
  if (s.length > 200) return false;
  if (s.startsWith("/") || s.startsWith("~")) return false; // absolute → not a workspace-relative path
  if (s.includes(" ")) return false;
  if (s.includes("://")) return false;
  return FILE_PATH_RE.test(s);
}

export function MessageBubble({ turn, onFilePathClick }: Props) {
  const isUser = turn.role === "user";
  const hasAttachments = (turn.attachments?.length ?? 0) > 0;

  // ReactMarkdown component override: inline `code` whose content looks like
  // a workspace-relative file path becomes a clickable button.
  const markdownComponents = {
    code(props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
      const text = childToText(props.children);
      // Only inline code: a `pre > code` will have block CSS; we let the
      // default styling render code blocks, never link them.
      const isBlock = (props as { node?: { tagName?: string } })?.node?.tagName === "code"
        ? false
        : false;
      void isBlock;
      if (onFilePathClick && looksLikeFilePath(text)) {
        return (
          <code
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onFilePathClick(text);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onFilePathClick(text);
              }
            }}
            className="cursor-pointer text-gold-deep underline-offset-2 hover:underline"
            title="편집기로 열기"
          >
            {props.children}
          </code>
        );
      }
      return <code {...props}>{props.children}</code>;
    },
  };

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-elevated ring-1 ring-border">
          <Emblem size={28} className="h-7 w-7" />
        </div>
      )}
      <div
        className={`flex min-w-0 max-w-[calc(100%-3rem)] flex-col gap-1.5 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {hasAttachments && (
          <div
            className={`flex flex-wrap gap-1.5 ${isUser ? "justify-end" : "justify-start"}`}
          >
            {turn.attachments!.map((a, i) => (
              <AttachmentChip key={`${a.path}-${i}`} attachment={a} />
            ))}
          </div>
        )}
        {turn.text || turn.toolCalls.length > 0 ? (
          <div
            className={`group/bubble relative rounded-2xl px-4 py-3 ${
              isUser
                ? "bg-navy text-white"
                : "bg-bg-elevated border border-border"
            }`}
          >
            {turn.text && <CopyButton text={turn.text} isUser={isUser} /> }
            {turn.text && (
              <div
                className={`prose-chat text-sm ${
                  isUser ? "text-white [&_strong]:text-white [&_code]:bg-white/10 [&_code]:text-white" : "text-fg"
                }`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {turn.text}
                </ReactMarkdown>
                {turn.isStreaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse-soft bg-gold" />
                )}
              </div>
            )}
            {!isUser &&
              turn.toolCalls.map((c) => (
                <ToolCallCard
                  key={c.id}
                  call={c}
                  onFilePathClick={onFilePathClick}
                />
              ))}
            {!isUser && turn.isStreaming && !turn.text && turn.toolCalls.length === 0 && (
              <ThinkingIndicator />
            )}
          </div>
        ) : null}
        {turn.error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-pre-line">{turn.error}</span>
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-sunken text-fg-muted">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      className="flex items-center gap-2.5 text-sm"
      role="status"
      aria-live="polite"
      aria-label="AI가 응답을 준비하고 있어요"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </span>
      <span className="thinking-text font-medium">생각하고 있어요</span>
    </div>
  )
}

function CopyButton({ text, isUser }: { text: string; isUser: boolean }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 거부 — 조용히 무시 */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "복사됨" : "복사"}
      aria-label={copied ? "복사됨" : "메시지 복사"}
      className={`absolute -top-2 ${
        isUser ? "-left-2" : "-right-2"
      } flex h-6 w-6 items-center justify-center rounded-md border opacity-0 transition group-hover/bubble:opacity-100 ${
        isUser
          ? "border-navy-soft bg-navy text-white/80 hover:bg-navy-soft hover:text-white"
          : "border-border bg-bg-elevated text-fg-muted hover:bg-bg-sunken hover:text-fg"
      }`}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function childToText(node: React.ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childToText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return childToText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}
