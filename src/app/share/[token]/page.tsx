"use client";

import { use, useEffect, useState } from "react";
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Eye,
  Loader2,
  FileText,
} from "lucide-react";
import { apiUrl } from "@/lib/client/url";
import { Emblem } from "@/components/Emblem";
import { CodeEditor } from "@/components/CodeEditor";
import type { TreeNode } from "@/lib/client/types";

type ShareData = {
  projectName: string;
  tree: TreeNode[];
  createdAt: number;
  ownerInitial: string;
};

type FileData = {
  path: string;
  size: number;
  truncated: boolean;
  content: string;
};

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    fetch(apiUrl(`/api/share/${encodeURIComponent(token)}`))
      .then(async (r) => {
        const j = await r.json();
        if (abort) return;
        if (!r.ok) {
          setError(j.error || "공유 링크를 찾을 수 없습니다.");
          return;
        }
        setData(j as ShareData);
      })
      .catch((e) => !abort && setError(e.message));
    return () => {
      abort = true;
    };
  }, [token]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      return;
    }
    let abort = false;
    setFileLoading(true);
    setFileError(null);
    const qs = new URLSearchParams({ path: selectedPath });
    fetch(
      apiUrl(`/api/share/${encodeURIComponent(token)}/file?${qs.toString()}`),
    )
      .then(async (r) => {
        const j = await r.json();
        if (abort) return;
        if (!r.ok) {
          setFileError(j.error || "파일을 불러올 수 없습니다.");
          setFile(null);
          return;
        }
        setFile(j as FileData);
      })
      .catch((e) => !abort && setFileError(e.message))
      .finally(() => !abort && setFileLoading(false));
    return () => {
      abort = true;
    };
  }, [selectedPath, token]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-elevated p-2 shadow-sm ring-1 ring-border">
          <Emblem size={40} className="h-10 w-10" />
        </div>
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">
          Duksoo Code
        </h1>
        <div className="mt-4 max-w-sm rounded-xl border border-danger/30 bg-red-50 px-4 py-3 text-center text-sm text-danger">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-fg-subtle">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 공유 정보 불러오는 중…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg-elevated px-6">
        <div className="flex items-center gap-3">
          <Emblem size={32} className="h-8 w-8" />
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold tracking-tight text-fg">
              {data.projectName}
            </span>
            <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg">
              공유 (읽기 전용)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Eye className="h-3.5 w-3.5" />
          <span>{new Date(data.createdAt).toLocaleString("ko-KR")} 공유</span>
        </div>
      </header>
      <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr]">
        <aside className="flex h-full flex-col border-r border-border bg-bg-elevated">
          <div className="border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            파일
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {data.tree.length === 0 ? (
              <div className="px-4 py-3 text-xs text-fg-subtle">비어 있음</div>
            ) : (
              data.tree.map((n) => (
                <ShareTreeRow
                  key={n.path}
                  node={n}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                />
              ))
            )}
          </div>
        </aside>
        <main className="flex h-full flex-col">
          {!selectedPath ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-fg-subtle">
              <FileText className="h-8 w-8" strokeWidth={1.5} />
              <p className="mt-3 text-sm">파일을 선택하면 내용이 표시됩니다.</p>
              <p className="mt-1 text-[11px]">
                읽기 전용 공유 — 편집은 비활성화돼 있습니다.
              </p>
            </div>
          ) : fileLoading && !file ? (
            <div className="px-4 py-3 text-xs text-fg-subtle">불러오는 중…</div>
          ) : fileError ? (
            <div className="m-4 rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-xs text-danger">
              {fileError}
            </div>
          ) : file ? (
            <>
              <div className="flex h-10 items-center gap-2 border-b border-border px-4 text-xs text-fg-muted">
                <FileText className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="font-mono">{file.path}</span>
                {file.truncated && (
                  <span className="rounded bg-gold-soft px-1.5 py-0.5 text-[10px] text-gold-deep">
                    512KB까지만 표시
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <CodeEditor path={file.path} value={file.content} readOnly />
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ShareTreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selectedPath === node.path;
  const isDir = node.type === "dir";
  return (
    <div>
      <button
        onClick={() => (isDir ? setOpen((o) => !o) : onSelect(node.path))}
        className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
          isSelected
            ? "bg-navy/10 text-fg"
            : "text-fg-muted hover:bg-bg-sunken hover:text-fg"
        }`}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {isDir ? (
          <>
            <ChevronRight
              className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            />
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gold" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-gold" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <div>
          {node.children.map((c) => (
            <ShareTreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
