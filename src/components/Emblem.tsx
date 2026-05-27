"use client";

import { useState } from "react";

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const PNG_SRC = `${BASE}/duksoo-emblem.png`;
const SVG_FALLBACK = `${BASE}/duksoo-emblem.svg`;

/**
 * Duksoo High School emblem.
 *
 * Tries `public/duksoo-emblem.png` first (drop the real school PNG there).
 * If the PNG isn't found, falls back to the SVG approximation shipped at
 * `public/duksoo-emblem.svg`, so the UI never shows a broken image.
 *
 * We always render the image inside a square box with `object-contain` so the
 * native aspect ratio is preserved even if the source asset isn't perfectly
 * square (any non-square crop just gets letterboxed instead of stretched).
 */
export function Emblem({ size = 32, className, alt = "덕수고등학교 교표" }: Props) {
  const [src, setSrc] = useState(PNG_SRC);
  const cls = ["object-contain", className].filter(Boolean).join(" ");
  return (
    // We intentionally use a plain <img> rather than next/image so the
    // onError fallback to the bundled SVG works cleanly when the PNG file
    // is not present (next/image throws on missing assets).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      className={cls}
      style={{ aspectRatio: "1 / 1" }}
      onError={() => {
        if (src !== SVG_FALLBACK) setSrc(SVG_FALLBACK);
      }}
    />
  );
}
