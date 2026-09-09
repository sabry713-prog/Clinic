/**
 * FixedPopover — renders a floating panel in a document.body portal with
 * fixed positioning computed from its anchor element.
 *
 * Why: evidence cutaways and badge tooltips used `absolute` positioning,
 * which any `overflow-y-auto` ancestor (drawer stream, timeline pane, the
 * 3-pane shell) clips to a partial window. A body-level portal with fixed
 * coordinates floats above every pane regardless of nesting.
 *
 * Positioning: below the anchor, inline-end aligned (mirrors the old
 * `end-0 top-full` semantics in both LTR and RTL), clamped to the viewport
 * and flipped above the anchor when there is more room there. Outside
 * mousedown closes; the anchor's own click path is exempt so toggle
 * buttons keep working.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface FixedPopoverProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Panel width in px (default 384 = w-96). */
  readonly width?: number;
  /** Classes for the visible panel (radius, border, shadow, padding…). */
  readonly className?: string;
  /** Accessible role for the floating panel. */
  readonly role?: string;
  readonly ariaLabel?: string;
  /** Test id for the floating panel. */
  readonly testId?: string;
  /** Hover bridge: fired when the pointer enters/leaves the panel, so
   * hover-opened popovers can stay open while the pointer travels from
   * anchor to panel across the positioning gap. */
  readonly onPanelMouseEnter?: () => void;
  readonly onPanelMouseLeave?: () => void;
}

export default function FixedPopover({
  anchorRef,
  open,
  onClose,
  children,
  width = 384,
  className = "",
  role,
  ariaLabel,
  testId,
  onPanelMouseEnter,
  onPanelMouseLeave,
}: FixedPopoverProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelH = panelRef.current?.offsetHeight ?? 260;

    const rtl = document.documentElement.dir === "rtl";
    // inline-end alignment: LTR anchors the panel's right edge to the
    // anchor's right edge; RTL mirrors it to the left edges.
    let left = rtl ? anchor.left : anchor.right - width;
    left = Math.min(Math.max(8, left), Math.max(8, vw - width - 8));

    let top = anchor.bottom + 6;
    if (top + panelH > vh - 8 && anchor.top - panelH - 6 > 8) {
      top = anchor.top - panelH - 6; // flip above when it fits better
    }
    setStyle({ position: "fixed", top: Math.round(top), left: Math.round(left), width });
  }, [open, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return; // trigger handles itself
      if (panelRef.current?.contains(t)) return; // clicks inside stay inside
      onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`z-50 ${className}`}
      style={style}
      onMouseEnter={onPanelMouseEnter}
      onMouseLeave={onPanelMouseLeave}
    >
      {children}
    </div>,
    document.body,
  );
}
