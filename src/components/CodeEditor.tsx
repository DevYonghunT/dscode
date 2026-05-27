"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Loader2 } from "lucide-react";

// Monaco is heavy (~2MB) — load only on the client and avoid SSR.
const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 에디터 로딩 중…
    </div>
  ),
});

type Props = {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange?: (next: string) => void;
};

// Minimal extension → Monaco language ID map. Unmatched files fall back to
// plain text (Monaco's behavior when language is undefined).
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  sql: "sql",
  vue: "html",
  svelte: "html",
  dockerfile: "dockerfile",
};

function languageFor(filePath: string): string | undefined {
  const base = filePath.split("/").pop() || filePath;
  const lower = base.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return undefined;
  const ext = base.slice(idx + 1).toLowerCase();
  return LANG_BY_EXT[ext];
}

export function CodeEditor({ path, value, readOnly, onChange }: Props) {
  const language = useMemo(() => languageFor(path), [path]);
  return (
    <Monaco
      key={path}
      height="100%"
      language={language}
      value={value}
      theme="vs"
      options={{
        readOnly: readOnly === true,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily:
          '"JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderWhitespace: "selection",
        padding: { top: 8, bottom: 8 },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        automaticLayout: true,
        tabSize: 2,
      }}
      onChange={(v) => onChange?.(v ?? "")}
    />
  );
}
