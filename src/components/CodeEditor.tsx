"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
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

// 현재 적용 중인 테마를 globals.css 와 동일한 우선순위로 판정한다.
//   data-theme="light" → 라이트, "dark" → 다크, 미지정 → 시스템(prefers-color-scheme).
// 클라이언트에서만 호출(window/document 접근).
function resolveDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light") return false;
  if (attr === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// 다크/라이트 여부를 구독한다. SSR/hydration 안전을 위해 초기값은 false(라이트)로
// 두고, 마운트 후 클라이언트에서 실제 값으로 동기화한다.
//   - 사용자 토글: <html> 의 data-theme 속성 변경 → MutationObserver
//   - 시스템 변경: prefers-color-scheme → matchMedia change
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(resolveDark());
    update();

    // data-theme 속성(사용자 토글) 변경 감지
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // 시스템 prefers-color-scheme 변경 감지 (data-theme 미지정 시 반영됨)
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", update);

    return () => {
      observer.disconnect();
      mql.removeEventListener("change", update);
    };
  }, []);
  return isDark;
}

// globals.css 의 --font-mono 토큰을 읽어 Monaco 폰트와 일치시킨다.
// 토큰을 못 읽으면 기존 하드코딩 스택으로 폴백한다. 클라이언트에서만 호출.
const FALLBACK_FONT =
  '"JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace';

function readMonoFont(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return v || FALLBACK_FONT;
}

export function CodeEditor({ path, value, readOnly, onChange }: Props) {
  const language = useMemo(() => languageFor(path), [path]);
  const isDark = useIsDark();
  // --font-mono 는 마운트 후 클라이언트에서만 읽는다(SSR 안전). 초기엔 폴백.
  const [fontFamily, setFontFamily] = useState(FALLBACK_FONT);
  useEffect(() => {
    setFontFamily(readMonoFont());
  }, []);
  return (
    <Monaco
      key={path}
      height="100%"
      language={language}
      value={value}
      theme={isDark ? "vs-dark" : "vs"}
      options={{
        readOnly: readOnly === true,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily,
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
