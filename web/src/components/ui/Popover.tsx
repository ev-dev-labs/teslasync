import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type PopoverAlign = 'start' | 'end' | 'center';
export type PopoverSide = 'bottom' | 'top';

export interface PopoverProps {
  /** Whether the popover content is shown. */
  open: boolean;
  /** Called when the popover requests to close (Esc, click outside, focus out). */
  onClose: () => void;
  /**
   * Ref to the trigger element. Position is computed relative to its bounding
   * rect; focus is restored to it on close.
   */
  anchorRef: RefObject<HTMLElement>;
  /** Side relative to the anchor. Auto-flips when there isn't enough viewport space. */
  side?: PopoverSide;
  /** Alignment along the cross axis. */
  align?: PopoverAlign;
  /** Pixel gap between anchor and popover. */
  sideOffset?: number;
  /** Optional class for the content surface. */
  className?: string;
  /** ARIA label for the popover region (when no internal heading exists). */
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Lightweight popover primitive. Portals content to <body>, positions it
 * relative to `anchorRef`, and closes on Esc / click-outside / blur-out.
 * Intentionally NOT a focus trap (popovers should let users tab back to the
 * trigger and beyond). When you need a focus trap, use {@link Modal}.
 * Auto-flips `side` when the requested side overflows the viewport, and
 * shifts horizontally to keep the content within the viewport.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  className,
  ariaLabel,
  children,
}: PopoverProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; resolvedSide: PopoverSide } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const compute = () => {
      const anchor = anchorRef.current;
      const content = contentRef.current;
      if (!anchor || !content) return;

      const a = anchor.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;

      // Resolve side: flip if requested side overflows.
      let resolvedSide: PopoverSide = side;
      const spaceBelow = vh - a.bottom - sideOffset - margin;
      const spaceAbove = a.top - sideOffset - margin;
      if (side === 'bottom' && c.height > spaceBelow && spaceAbove > spaceBelow) {
        resolvedSide = 'top';
      } else if (side === 'top' && c.height > spaceAbove && spaceBelow > spaceAbove) {
        resolvedSide = 'bottom';
      }

      let top: number;
      if (resolvedSide === 'bottom') {
        top = a.bottom + sideOffset;
      } else {
        top = a.top - sideOffset - c.height;
      }

      let left: number;
      if (align === 'start') {
        left = a.left;
      } else if (align === 'end') {
        left = a.right - c.width;
      } else {
        left = a.left + a.width / 2 - c.width / 2;
      }

      // Clamp horizontally to viewport.
      if (left + c.width + margin > vw) left = vw - c.width - margin;
      if (left < margin) left = margin;

      // Clamp vertically (rare — only if both sides overflow).
      if (top + c.height + margin > vh) top = vh - c.height - margin;
      if (top < margin) top = margin;

      setPos({ top, left, resolvedSide });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, side, align, sideOffset, anchorRef]);

  // Restore focus to trigger when the popover closes.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const activeElement = document.activeElement;
      const focusStayedWithPopover =
        !activeElement ||
        activeElement === document.body ||
        activeElement === anchorRef.current ||
        contentRef.current?.contains(activeElement);
      if (focusStayedWithPopover) {
        anchorRef.current?.focus?.();
      }
    }
  }, [open, anchorRef]);

  // Esc + click-outside (pointerdown so it fires before focus changes).
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  const content = (
    <div
      ref={contentRef}
      role="dialog"
      aria-label={ariaLabel}
      aria-modal="false"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 60,
      }}
      className={cn(
        'rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl',
        'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        className,
      )}
    >
      {children}
    </div>
  );

  return createPortal(content, document.body);
}
