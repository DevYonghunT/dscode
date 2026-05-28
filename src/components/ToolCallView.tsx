"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  FolderTree,
  FileText,
  FilePlus,
  Edit3,
  Search,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Link2,
  ExternalLink,
  GitBranch,
  Rocket,
  ListChecks,
} from "lucide-react";
import type { ToolCallView } from "@/lib/client/types";

// Map Claude Agent SDK built-in tool names → icon + Korean label.
const TOOL_META: Record<string, { Icon: typeof FolderTree; label: string }> = {
  Read: { Icon: FileText, label: "파일 읽기" },
  Write: { Icon: FilePlus, label: "파일 쓰기" },
  Edit: { Icon: Edit3, label: "파일 편집" },
  MultiEdit: { Icon: Edit3, label: "파일 편집" },
  Glob: { Icon: FolderTree, label: "파일 검색" },
  Grep: { Icon: Search, label: "내용 검색" },
  Bash: { Icon: Terminal, label: "셸 실행" },
  BashOutput: { Icon: Terminal, label: "셸 출력 읽기" },
  KillShell: { Icon: Terminal, label: "셸 종료" },
  WebSearch: { Icon: Globe, label: "웹 검색" },
  WebFetch: { Icon: Link2, label: "웹 페이지 가져오기" },
  TodoWrite: { Icon: ListChecks, label: "할 일 갱신" },
  Task: { Icon: ListChecks, label: "서브 에이전트" },
};

function detectBashKind(cmd: string): "git" | "vercel" | "gh" | "bash" {
  const c = cmd.trimStart();
  if (c.startsWith("vercel ") || c.startsWith("vercel\n")) return "vercel";
  if (c.startsWith("gh ") || c.startsWith("gh\n")) return "gh";
  if (
    c.startsWith("git ") ||
    c.startsWith("git\n") ||
    /^\(?\s*git\b/.test(c)
  )
    return "git";
  return "bash";
}

function bashKindMeta(kind: "git" | "vercel" | "gh" | "bash") {
  if (kind === "git") return { Icon: GitBranch, label: "Git 작업" };
  if (kind === "gh") return { Icon: GitBranch, label: "GitHub CLI" };
  if (kind === "vercel") return { Icon: Rocket, label: "Vercel 배포" };
  return { Icon: Terminal, label: "셸 실행" };
}

/** Try to JSON-parse a tool output string (Claude often returns JSON). */
function tryParseJson(s: string): unknown {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Extract https://*.vercel.app URLs from a bash output blob. */
function extractVercelUrls(s: string): string[] {
  const matches = s.match(/https:\/\/[a-z0-9-]+\.vercel\.app[^\s)]*/gi) || [];
  // de-dup while keeping order
  return Array.from(new Set(matches));
}

type CardProps = {
  call: ToolCallView;
  /** Called when the user clicks a file path mentioned in this tool call. */
  onFilePathClick?: (path: string) => void;
};

export function ToolCallCard({ call, onFilePathClick }: CardProps) {
  const [open, setOpen] = useState(false);
  const running = call.output === undefined;

  // Resolve display icon + label, with Bash sub-classification (git/vercel/gh).
  const { Icon, label } = useMemo(() => {
    if (call.name === "Bash") {
      const cmd = (call.input?.command as string) || "";
      return bashKindMeta(detectBashKind(cmd));
    }
    const m = TOOL_META[call.name];
    if (m) return m;
    return { Icon: Terminal, label: call.name };
  }, [call.name, call.input]);

  /** File path mentioned in this tool call's input, if any — for click-to-open. */
  const filePath = useMemo<string | null>(() => {
    if (!call.input) return null;
    const i = call.input as Record<string, unknown>;
    if (
      call.name === "Read" ||
      call.name === "Write" ||
      call.name === "Edit" ||
      call.name === "MultiEdit" ||
      call.name === "NotebookEdit"
    ) {
      const fp = (i.file_path as string) || (i.notebook_path as string);
      return typeof fp === "string" && fp.length > 0 ? fp : null;
    }
    return null;
  }, [call.name, call.input]);

  // One-line summary for the collapsed card.
  const summary = useMemo(() => {
    if (!call.input) return "";
    const i = call.input as Record<string, unknown>;
    if (filePath) return filePath;
    if (call.name === "Glob") return (i.pattern as string) || "";
    if (call.name === "Grep") {
      const pattern = (i.pattern as string) || "";
      const ipath = (i.path as string) || "";
      return ipath ? `${pattern}  ↳ ${ipath}` : pattern;
    }
    if (call.name === "Bash") {
      const c = (i.command as string) || "";
      return c.length > 120 ? c.slice(0, 117) + "…" : c;
    }
    if (call.name === "WebSearch") return (i.query as string) || "";
    if (call.name === "WebFetch") return (i.url as string) || "";
    if (call.name === "TodoWrite") {
      const todos = i.todos as Array<{ content?: string }> | undefined;
      return todos ? `${todos.length}개 항목` : "";
    }
    return "";
  }, [call.name, call.input, filePath]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-bg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-bg-sunken"
      >
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
            call.isError
              ? "bg-red-50 text-danger"
              : running
                ? "bg-bg-sunken text-fg-muted"
                : "bg-gold-soft text-gold-deep"
          }`}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : call.isError ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-fg">{label}</span>
          {filePath && onFilePathClick ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onFilePathClick(filePath);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onFilePathClick(filePath);
                }
              }}
              className="truncate rounded font-mono text-xs text-gold-deep underline-offset-2 hover:underline"
              title="편집기로 열기"
            >
              {filePath}
            </span>
          ) : summary ? (
            <span className="truncate font-mono text-xs text-fg-subtle">{summary}</span>
          ) : null}
        </div>
        {!running && !call.isError && (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success/60" />
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Rich preview row — outside the collapsible — for high-signal tools. */}
      {!running && !call.isError && (
        <RichPreview name={call.name} input={call.input} output={call.output} />
      )}

      {open && (
        <div className="border-t border-border bg-bg-sunken px-3 py-2">
          {call.input && Object.keys(call.input).length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                입력
              </div>
              <pre className="overflow-x-auto rounded bg-bg-elevated p-2 font-mono text-[11px] leading-relaxed text-fg-muted">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.output !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                {call.isError ? "오류" : "결과"}
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-bg-elevated p-2 font-mono text-[11px] leading-relaxed text-fg-muted whitespace-pre-wrap">
                {call.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RichPreview({
  name,
  input,
  output,
}: {
  name: string;
  input: Record<string, unknown> | null;
  output?: string;
}) {
  if (!output) return null;

  // ── WebSearch — render result list (title + url) ─────────────────────────
  if (name === "WebSearch") {
    const parsed = tryParseJson(output) as
      | {
          results?: Array<
            | { content?: Array<{ title?: string; url?: string }> }
            | string
            | { title?: string; url?: string }
          >;
        }
      | null;
    const items: { title: string; url: string }[] = [];
    if (parsed && Array.isArray(parsed.results)) {
      for (const r of parsed.results) {
        if (r && typeof r === "object" && "content" in r && Array.isArray(r.content)) {
          for (const c of r.content) {
            if (c?.title && c?.url) items.push({ title: c.title, url: c.url });
          }
        } else if (r && typeof r === "object" && "title" in r && "url" in r) {
          const rr = r as { title?: string; url?: string };
          if (rr.title && rr.url) items.push({ title: rr.title, url: rr.url });
        }
      }
    }
    if (items.length === 0) return null;
    return (
      <div className="border-t border-border bg-bg-elevated px-3 py-2">
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((it, i) => (
            <li key={i} className="min-w-0">
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-1.5 text-xs"
              >
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle group-hover:text-gold-deep" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg group-hover:text-gold-deep group-hover:underline">
                    {it.title}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-fg-subtle">
                    {it.url}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        {items.length > 8 && (
          <p className="mt-1 text-[10px] text-fg-subtle">
            …그 외 {items.length - 8}개
          </p>
        )}
      </div>
    );
  }

  // ── WebFetch — show URL header + snippet ────────────────────────────────
  if (name === "WebFetch" && input) {
    const url = (input.url as string) || "";
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    const snippet = output.length > 320 ? output.slice(0, 320) + "…" : output;
    return (
      <div className="border-t border-border bg-bg-elevated px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Link2 className="h-3 w-3 text-fg-subtle" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono hover:text-gold-deep hover:underline"
          >
            {host}
          </a>
        </div>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg">
          {snippet}
        </p>
      </div>
    );
  }

  // ── Bash + vercel deploy — surface deployment URLs as big buttons ───────
  if (name === "Bash" && input) {
    const cmd = (input.command as string) || "";
    if (detectBashKind(cmd) === "vercel") {
      const urls = extractVercelUrls(output);
      if (urls.length > 0) {
        return (
          <div className="border-t border-border bg-bg-elevated px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              배포 URL
            </div>
            <div className="flex flex-wrap gap-1.5">
              {urls.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-navy-soft"
                >
                  <Rocket className="h-3 w-3" />
                  <span className="font-mono">{new URL(u).host}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ))}
            </div>
          </div>
        );
      }
    }
  }

  return null;
}
