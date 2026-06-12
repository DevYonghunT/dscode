"use client";

import { memo, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

// ReactMarkdown 의 components 매핑을 만드는 팩토리. 매 렌더마다 객체를 새로
// 만들면 ReactMarkdown 이 매번 재파싱하므로, onFilePathClick 별로 한 번만
// 만들어 useMemo 로 캐싱한다(아래 컴포넌트 내부). onFilePathClick 이 없을 때는
// 모듈 레벨 상수(EMPTY_COMPONENTS)를 재사용해 참조 안정성을 보장한다.
function buildMarkdownComponents(
  onFilePathClick: (path: string) => void,
): Components {
  return {
    code(props) {
      const text = childToText(props.children);
      if (looksLikeFilePath(text)) {
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
}

// onFilePathClick 이 없으면 파일 경로 링크 기능이 불필요하므로 빈 매핑을 공유한다.
const EMPTY_COMPONENTS: Components = {};

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

function MessageBubbleInner({ turn, onFilePathClick }: Props) {
  const isUser = turn.role === "user";
  const hasAttachments = (turn.attachments?.length ?? 0) > 0;

  // ReactMarkdown components 매핑을 onFilePathClick 별로 한 번만 생성해 캐싱.
  // (매 렌더마다 새 객체를 넘기면 ReactMarkdown 이 매번 재파싱한다.)
  const markdownComponents = useMemo(
    () =>
      onFilePathClick ? buildMarkdownComponents(onFilePathClick) : EMPTY_COMPONENTS,
    [onFilePathClick],
  );

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
                {turn.isStreaming ? (
                  // 스트리밍 중에는 토큰마다 마크다운을 재파싱하면 O(n^2) 비용이
                  // 들어 메인스레드를 점유한다. 도중에는 plain text(공백 보존)로
                  // 가볍게 렌더하고, done(isStreaming=false) 시 마크다운으로 전환.
                  <p className="whitespace-pre-wrap break-words">{turn.text}</p>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {turn.text}
                  </ReactMarkdown>
                )}
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
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
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

// React.memo: turn(객체)/onFilePathClick 이 동일하면 리렌더를 건너뛴다.
// onFilePathClick 은 Chat.tsx 에서 useCallback 으로 안정화되고, 스트리밍 중
// 변경되는 버블은 마지막 turn 만이므로 나머지 버블의 마크다운 재파싱을 피한다.
export const MessageBubble = memo(MessageBubbleInner);

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
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
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
