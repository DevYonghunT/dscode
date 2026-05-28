"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Send, Square, Paperclip, ImagePlus } from "lucide-react";
import type { ChatTurn } from "@/lib/client/types";
import type { ModelId } from "@/lib/client/models";
import { MessageBubble } from "./MessageBubble";
import { Emblem } from "./Emblem";
import { AttachmentChip } from "./AttachmentChip";
import { ModelPicker } from "./ModelPicker";

type Props = {
  turns: ChatTurn[];
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  onSend: (text: string, files?: File[]) => void;
  onStop: () => void;
  /** Click handler when the user clicks a file path inside a chat message. */
  onFilePathClick?: (path: string) => void;
  model: ModelId;
  onChangeModel: (next: ModelId) => void;
};

const SUGGESTIONS = [
  "이 프로젝트 구조를 분석해줘",
  "package.json의 의존성을 정리해줘",
  "README.md 초안을 만들어줘",
  "TypeScript 에러가 있는지 확인해줘",
];

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.yml,.yaml,.xml,.csv,.tsv,.pdf,.txt";

export function Chat({
  turns,
  busy,
  disabled,
  disabledReason,
  onSend,
  onStop,
  onFilePathClick,
  model,
  onChangeModel,
}: Props) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (busy || disabled) return;
    if (!text && pending.length === 0) return;
    onSend(text, pending.length > 0 ? pending : undefined);
    setInput("");
    setPending([]);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setPending((prev) => [...prev, ...arr]);
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || busy) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled || busy) return;
    if (!isDragging) setIsDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only clear when leaving the chat surface entirely
    if (e.target === e.currentTarget) setIsDragging(false);
  }

  return (
    <section
      className="relative flex h-full flex-col bg-bg"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-navy/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-gold bg-bg-elevated px-8 py-6 shadow-lg">
            <p className="text-center font-display text-base font-semibold text-fg">
              여기에 놓아 첨부
            </p>
            <p className="mt-1 text-xs text-fg-muted">이미지·텍스트·PDF 지원</p>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {turns.length === 0 ? (
            <EmptyState onPick={(s) => setInput(s)} />
          ) : (
            turns.map((t) => (
              <MessageBubble
                key={t.id}
                turn={t}
                onFilePathClick={onFilePathClick}
              />
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border bg-bg-elevated">
        <form onSubmit={submit} className="mx-auto w-full max-w-3xl px-6 py-4">
          {disabled && disabledReason && (
            <div className="mb-3 rounded-lg border border-gold/30 bg-gold-soft/50 px-3 py-2 text-xs text-gold-deep">
              {disabledReason}
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((f, i) => (
                <AttachmentChip
                  key={`${f.name}-${i}`}
                  file={f}
                  onRemove={() =>
                    setPending((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-border bg-bg px-3 py-2.5 transition-colors focus-within:border-border-strong focus-within:bg-bg-elevated">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={onFileInput}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || busy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              title="파일 첨부"
              aria-label="파일 첨부"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={onKeyDown}
              placeholder={
                disabled
                  ? "설정을 먼저 완료해주세요…"
                  : "무엇을 도와드릴까요? (Shift+Enter 줄바꿈, 파일 드래그)"
              }
              disabled={disabled}
              rows={1}
              // py + leading combine to match the buttons' 36px height for the
              // single-line case (so cursor + placeholder sit centered, not at
              // the bottom). For multi-line, scrollHeight + items-end lets the
              // textarea grow upward while the buttons stay at the bottom.
              className="flex-1 resize-none bg-transparent py-[7px] text-sm leading-[22px] text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
              style={{ maxHeight: 200 }}
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-white transition-colors hover:bg-navy-soft"
                title="중단"
                aria-label="중단"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || (!input.trim() && pending.length === 0)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-white transition-all hover:bg-navy-soft disabled:cursor-not-allowed disabled:bg-bg-sunken disabled:text-fg-subtle"
                title="보내기"
                aria-label="보내기"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-1">
            <ModelPicker value={model} onChange={onChangeModel} disabled={busy} />
            <p className="text-center text-[11px] text-fg-subtle">
              Duksoo Code(DS Code)는 워크스페이스의 파일을 읽고/쓰고 셸·웹 검색·배포까지 수행할 수 있습니다.
            </p>
            <span className="w-[68px]" aria-hidden /> {/* spacer to balance picker width */}
          </div>
        </form>
      </div>
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated p-2 shadow-md ring-1 ring-border">
        <Emblem size={48} className="block h-12 w-12" />
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          무엇을 도와드릴까요?
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          여러분의 워크스페이스를 이해하고 코드를 작성/수정/실행해드립니다.
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-fg-subtle">
          <ImagePlus className="h-3 w-3" />
          이미지·파일을 드래그하거나 클립 버튼으로 첨부할 수 있어요
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-bg-elevated px-4 py-3 text-left text-sm text-fg-muted shadow-sm transition-all hover:border-border-strong hover:bg-bg hover:text-fg hover:shadow-md"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
