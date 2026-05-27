"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/**
 * Three-column horizontal layout with two drag handles.
 *
 *   [ left ] | [ center (flex-1) ] | [ right ]
 *
 * Widths for left/right are stored in pixels; center fills remaining space.
 * Drag direction is symmetric — you can grow OR shrink either side as long
 * as the constraints (per-panel min, plus center min) are satisfied.
 */

const STORAGE_KEY = "dscode_layout_v3";

const DEFAULTS = { left: 280, right: 380 };
const LIMITS = {
  left: { min: 180, max: 560 },
  right: { min: 220, max: 720 },
  centerMin: 360,
};

type Saved = { left: number; right: number };

type Props = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

export function ResizableLayout({ left, center, right }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number>(DEFAULTS.left);
  const [rightWidth, setRightWidth] = useState<number>(DEFAULTS.right);
  const [restored, setRestored] = useState(false);

  // Restore once on mount. Discard saved widths that violate the constraints.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Partial<Saved>;
        const l = typeof obj.left === "number" ? obj.left : DEFAULTS.left;
        const r = typeof obj.right === "number" ? obj.right : DEFAULTS.right;
        setLeftWidth(clamp(l, LIMITS.left.min, LIMITS.left.max));
        setRightWidth(clamp(r, LIMITS.right.min, LIMITS.right.max));
      }
    } catch {
      /* ignore */
    }
    setRestored(true);
  }, []);

  // Debounced save.
  useEffect(() => {
    if (!restored) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ left: leftWidth, right: rightWidth }),
        );
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [leftWidth, rightWidth, restored]);

  // Re-clamp on window resize so a narrow viewport can't leave us in an
  // impossible state (e.g. left + right + center > containerW).
  useEffect(() => {
    function onResize() {
      const w = containerRef.current?.getBoundingClientRect().width || 0;
      if (w === 0) return;
      const available = w - LIMITS.centerMin;
      if (leftWidth + rightWidth > available) {
        // Shrink right first, then left, proportionally.
        const overflow = leftWidth + rightWidth - available;
        const newRight = Math.max(LIMITS.right.min, rightWidth - overflow);
        const consumedFromRight = rightWidth - newRight;
        const remaining = overflow - consumedFromRight;
        setRightWidth(newRight);
        if (remaining > 0) {
          setLeftWidth(Math.max(LIMITS.left.min, leftWidth - remaining));
        }
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [leftWidth, rightWidth]);

  // ── Drag state ─────────────────────────────────────────────────────────
  type DragRef = {
    which: "left" | "right";
    startX: number;
    startLeft: number;
    startRight: number;
    containerW: number;
  } | null;
  const dragRef = useRef<DragRef>(null);

  const onPointerDown = useCallback(
    (which: "left" | "right") => (e: ReactPointerEvent<HTMLDivElement>) => {
      const containerW =
        containerRef.current?.getBoundingClientRect().width || 0;
      if (!containerW) return;
      // capture the pointer so move/up fire on this element even if the
      // cursor strays into another panel's content during the drag.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = {
        which,
        startX: e.clientX,
        startLeft: leftWidth,
        startRight: rightWidth,
        containerW,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [leftWidth, rightWidth],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const maxLeftByCenter =
        d.containerW - LIMITS.centerMin - d.startRight;
      const maxRightByCenter = d.containerW - LIMITS.centerMin - d.startLeft;

      if (d.which === "left") {
        // Drag right → grow left; drag left → shrink left.
        let next = d.startLeft + dx;
        next = clamp(
          next,
          LIMITS.left.min,
          Math.min(LIMITS.left.max, maxLeftByCenter),
        );
        setLeftWidth(next);
      } else {
        // Drag right → shrink right; drag left → grow right.
        let next = d.startRight - dx;
        next = clamp(
          next,
          LIMITS.right.min,
          Math.min(LIMITS.right.max, maxRightByCenter),
        );
        setRightWidth(next);
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [],
  );

  // Double-click resets neighbors. left handle resets left, right handle resets right.
  const onDoubleClick = useCallback((which: "left" | "right") => {
    if (which === "left") setLeftWidth(DEFAULTS.left);
    else setRightWidth(DEFAULTS.right);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full w-full">
      <div
        style={{ width: `${leftWidth}px` }}
        className="h-full shrink-0 overflow-hidden"
      >
        {left}
      </div>
      <Handle
        onPointerDown={onPointerDown("left")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onDoubleClick("left")}
      />
      <div className="h-full min-w-0 flex-1 overflow-hidden">{center}</div>
      <Handle
        onPointerDown={onPointerDown("right")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onDoubleClick("right")}
      />
      <div
        style={{ width: `${rightWidth}px` }}
        className="h-full shrink-0 overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function Handle(props: {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="드래그해서 폭 조절 · 더블클릭하면 기본 폭으로"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onDoubleClick={props.onDoubleClick}
      className="group/handle relative z-20 w-px shrink-0 cursor-col-resize touch-none select-none bg-border transition-colors hover:bg-gold-deep"
    >
      {/* Generous invisible grab area so users don't pixel-hunt. */}
      <div className="absolute inset-y-0 -left-2 -right-2" />
      {/* Soft handle indicator on hover. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-deep opacity-0 transition-opacity group-hover/handle:opacity-100" />
    </div>
  );
}
