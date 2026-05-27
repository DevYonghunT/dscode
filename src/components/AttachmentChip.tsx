"use client";

import { useEffect, useState } from "react";
import { X, FileText, Image as ImageIcon, FileCode, FileJson } from "lucide-react";
import type { Attachment } from "@/lib/client/types";

type Props = {
  /** Either a server-known attachment (with workspace path) or a pre-upload File. */
  attachment?: Attachment;
  file?: File;
  /** When set, show a remove (X) button. */
  onRemove?: () => void;
  size?: "sm" | "md";
};

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function NonImageIcon({ mime, className }: { mime: string; className: string }) {
  if (mime === "application/json") return <FileJson className={className} />;
  if (mime === "application/pdf" || mime === "application/zip")
    return <FileText className={className} />;
  if (mime.startsWith("text/")) return <FileCode className={className} />;
  return <FileText className={className} />;
}

/** A pill showing either an in-flight File (with thumbnail preview) or a stored attachment. */
export function AttachmentChip({ attachment, file, onRemove, size = "sm" }: Props) {
  const name = attachment?.name || file?.name || "file";
  const mime = attachment?.mime || file?.type || "application/octet-stream";
  const bytes = attachment?.size ?? file?.size ?? 0;
  const isImage = mime.startsWith("image/");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !isImage) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const padding = size === "sm" ? "px-2 py-1" : "px-3 py-1.5";

  return (
    <div
      className={`inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-border bg-bg-elevated ${padding} text-xs`}
    >
      {isImage && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt=""
          className="h-5 w-5 shrink-0 rounded object-cover"
        />
      ) : isImage ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      ) : (
        <NonImageIcon
          mime={mime}
          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
        />
      )}
      <span className="truncate font-medium text-fg" title={name}>
        {name}
      </span>
      <span className="shrink-0 text-fg-subtle">{bytesHuman(bytes)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-sunken hover:text-fg"
          aria-label="첨부 제거"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
