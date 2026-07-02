import { useCallback, type ComponentProps, type ReactNode, type RefObject } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';

/**
 * Radix types `Popover.Anchor`'s `virtualRef` as `RefObject<Measurable>`
 * (`Measurable` comes from the internal `@radix-ui/rect` package, which isn't
 * one of our direct dependencies — so it's derived here via `ComponentProps`
 * instead of imported by name).
 */
type PopoverVirtualRef = ComponentProps<typeof PopoverPrimitive.Anchor>['virtualRef'];

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
  anchorRef: RefObject<HTMLElement | null>;
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
 * Lightweight popover primitive built on Radix UI's `Popover`. Portals content
 * to `<body>` and positions it relative to `anchorRef` via Radix's
 * Popper/floating-ui placement engine — auto-flip and viewport clamping are
 * built in, and position tracks the anchor live on scroll/resize instead of
 * the old manual `resize`/`scroll` listener pair.
 *
 * Not a hard focus trap: Tab/Shift+Tab loop within the open content (Radix's
 * standard Popover keyboard contract) but Escape, an outside pointerdown, or
 * tabbing focus all the way out of the content close it and return focus to
 * the anchor. When you need a true modal focus trap, use {@link Modal}.
 *
 * The trigger button lives entirely OUTSIDE this component (owned by the
 * caller — see `anchorRef`), so placement is anchored to it via
 * `Popover.Anchor`'s `virtualRef` instead of rendering a `Popover.Trigger`.
 * Two consequences of that, both handled explicitly below:
 *   1. Radix's built-in "restore focus to the trigger on close" only knows
 *      about a real `Popover.Trigger`, so `onCloseAutoFocus` does it instead.
 *   2. Radix's built-in "clicking the trigger toggles, doesn't re-dismiss"
 *      also only knows about a real `Popover.Trigger`, so
 *      `onPointerDownOutside` explicitly ignores pointerdowns that land on
 *      the anchor — otherwise a caller's `onClick={() => setOpen(o => !o)}`
 *      trigger button would have its toggle-closed cancelled out by Radix's
 *      own dismiss-then-reopen sequence.
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
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {/*
        `virtualRef`'s `current` is typed non-null, but our `anchorRef` is
        `RefObject<HTMLElement | null>` — the anchor may not be mounted yet
        on first render. `HTMLElement` structurally satisfies `Measurable`
        (`getBoundingClientRect()`); Radix's own implementation reads
        `virtualRef.current` defensively and is fine with `null` at runtime
        (it feeds straight into a nullable `anchor` state internally), so
        this cast only relaxes a type that's stricter than the library's own
        null-safe runtime behavior.
      */}
      <PopoverPrimitive.Anchor virtualRef={anchorRef as unknown as PopoverVirtualRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={ariaLabel}
          aria-modal="false"
          onOpenAutoFocus={(e) => {
            // The original primitive never moved focus on open — callers
            // like the alert-message template autocomplete rely on focus
            // staying in their own `<textarea>` while suggestions render
            // alongside it.
            e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            anchorRef.current?.focus?.();
          }}
          onPointerDownOutside={(e) => {
            const target = e.target;
            if (anchorRef.current && target instanceof Node && anchorRef.current.contains(target)) {
              e.preventDefault();
            }
          }}
          className={cn(
            'z-[60] rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl',
            'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
            'scale-in',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
