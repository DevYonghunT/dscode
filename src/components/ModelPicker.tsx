"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import { MODELS, type ModelId } from "@/lib/client/models";

type Props = {
  value: ModelId;
  onChange: (next: ModelId) => void;
  disabled?: boolean;
};

export function ModelPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = MODELS.find((m) => m.id === value) || MODELS[0];

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-navy disabled:cursor-not-allowed disabled:opacity-50"
        title={`모델: ${active.label}`}
      >
        <Sparkles className="h-2.5 w-2.5 text-gold" />
        <span>{active.shortLabel}</span>
        <ChevronDown
          className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg">
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            모델 선택
          </div>
          <ul className="py-1">
            {MODELS.map((m) => {
              const selected = m.id === value;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                      selected ? "bg-navy/5" : "hover:bg-bg-sunken"
                    }`}
                  >
                    <Check
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        selected ? "text-gold" : "text-transparent"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-navy">
                        {m.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">
                        {m.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
