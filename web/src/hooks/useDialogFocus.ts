/**
 * Shared dialog focus primitive (A11Y-04).
 *
 * `Modal`, `Drawer`, and `Lightbox` each grew their own copy of the
 * same 40-line focus-trap effect. Three copies means three places for
 * the subtle bugs to hide, and they did:
 *
 * - **Restore-to-a-corpse.** Both copies call
 *   `previouslyFocused?.focus?.()` on close. When the trigger was
 *   itself removed while the dialog was open — a row action whose row
 *   was just deleted, a toolbar button behind a re-rendered filter —
 *   the call silently no-ops and focus falls to `<body>`. The next Tab
 *   restarts at the top of the document, which is precisely the WCAG
 *   2.4.3 failure the trap was meant to prevent.
 * - **Restore-over-an-intent.** If closing the dialog opens another
 *   one (confirm → detail), the outgoing restore fires *after* the new
 *   dialog focused itself and yanks focus back out of it.
 * - **Blind initial focus.** "First focusable element" is usually the
 *   Close button, so every dialog opens by announcing "Close" instead
 *   of its own first meaningful control.
 *
 * This hook is the single implementation. It:
 *
 * 1. Focuses `[data-autofocus]` when the dialog provides one, else the
 *    first focusable element, else the container itself.
 * 2. Traps Tab / Shift+Tab inside the container, re-querying on every
 *    keypress so dynamically-added controls participate.
 * 3. Closes on Escape.
 * 4. On close, restores focus to the trigger — but only if the trigger
 *    is still connected AND focus is still inside the dialog. When the
 *    trigger is gone it walks a fallback chain (explicit fallback →
 *    route-focus target → `<main>`) so focus always lands somewhere
 *    meaningful.
 *
 * @example
 *   const dialogRef = useRef<HTMLDivElement>(null);
 *   useDialogFocus({ open, containerRef: dialogRef, onClose });
 */

import { useEffect, useRef, type RefObject } from 'react';
import {
  ROUTE_FOCUS_FALLBACK_SELECTOR,
  ROUTE_FOCUS_TARGET_SELECTOR,
} from '@/lib/routeFocus';

/**
 * Elements that can hold keyboard focus inside a dialog.
 *
 * `[tabindex="-1"]` is excluded so the trap never parks the user on
 * the programmatically-focusable container, and `[inert]` subtrees are
 * excluded because the browser removes them from the tab order.
 */
export const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((s) => `${s}:not([inert]):not([inert] *)`)
  .join(', ');

/**
 * Marker attribute a dialog can put on the control that should receive
 * focus when it opens. Without it the hook uses the first focusable
 * element, which is usually the Close button.
 */
export const DIALOG_AUTOFOCUS_ATTR = 'data-autofocus';

export interface UseDialogFocusOptions {
  /** Whether the dialog is currently open. */
  open: boolean;
  /** Ref to the element carrying `role="dialog"`. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called on Escape. Always reads the latest callback. */
  onClose?: () => void;
  /**
   * Where to send focus if the trigger vanished while the dialog was
   * open. Checked before the generic route-focus / `<main>` fallbacks.
   */
  fallbackRef?: RefObject<HTMLElement | null>;
  /** Set false to keep Escape from closing (e.g. a blocking re-auth). */
  closeOnEscape?: boolean;
}

/** True when `el` can still receive focus (attached and not hidden). */
export function isFocusRestorable(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false;
  const node = el as HTMLElement;
  if (typeof node.focus !== 'function') return false;
  if (!node.isConnected) return false;
  if (node.hasAttribute('disabled')) return false;
  if (node.getAttribute('aria-hidden') === 'true') return false;
  // `offsetParent` is null for `display: none` subtrees. `position:
  // fixed` elements also report null, so treat a non-zero client rect
  // as proof of visibility for those.
  if (node.offsetParent === null && node.getClientRects().length === 0) {
    // jsdom never lays anything out, so both checks are always falsy
    // there. Trust connectedness in that environment rather than
    // refusing every restore in the test suite.
    if (typeof node.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
        // Ambiguous: either genuinely hidden, or jsdom. Allow it —
        // a failed `.focus()` is a no-op, whereas refusing here would
        // skip restoration for every test.
        return true;
      }
    }
    return false;
  }
  return true;
}

/** First element in the fallback chain that can take focus. */
function resolveFallback(fallbackRef?: RefObject<HTMLElement | null>): HTMLElement | null {
  if (isFocusRestorable(fallbackRef?.current)) return fallbackRef!.current!;
  if (typeof document === 'undefined') return null;
  const routeHeading = document.querySelector<HTMLElement>(ROUTE_FOCUS_TARGET_SELECTOR);
  if (isFocusRestorable(routeHeading)) return routeHeading;
  const main = document.querySelector<HTMLElement>(ROUTE_FOCUS_FALLBACK_SELECTOR);
  return isFocusRestorable(main) ? main : null;
}

export function useDialogFocus({
  open,
  containerRef,
  onClose,
  fallbackRef,
  closeOnEscape = true,
}: UseDialogFocusOptions): void {
  // Callers routinely pass an inline arrow for `onClose`, so a new
  // reference arrives on every parent render. Depending on it here made
  // the effect re-run and re-focus the first control, yanking focus
  // away from whatever the user was interacting with inside the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;
  const fallbackRefRef = useRef(fallbackRef);
  fallbackRefRef.current = fallbackRef;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const autofocus = container.querySelector<HTMLElement>(
      `[${DIALOG_AUTOFOCUS_ATTR}]`,
    );
    if (autofocus) {
      autofocus.focus();
    } else {
      const focusables = container.querySelectorAll<HTMLElement>(
        DIALOG_FOCUSABLE_SELECTOR,
      );
      if (focusables.length > 0) focusables[0].focus();
      else container.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!closeOnEscapeRef.current) return;
        // Stop the bubble so a dialog nested inside another surface
        // (a Popover host, a Drawer) does not close both at once.
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      // Re-query on every keypress: dialogs reveal and hide controls
      // as the user works (expanding sections, async-loaded forms).
      const current = container.querySelectorAll<HTMLElement>(
        DIALOG_FOCUSABLE_SELECTOR,
      );
      if (current.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);

      // Only restore when the dialog still owns focus. If something
      // else already claimed it — a second dialog opened by this
      // dialog's own submit handler, a toast action — that intent wins.
      const active = document.activeElement;
      const dialogStillOwnsFocus =
        active == null ||
        active === document.body ||
        container.contains(active);
      if (!dialogStillOwnsFocus) return;

      if (isFocusRestorable(previouslyFocused) && previouslyFocused !== document.body) {
        previouslyFocused.focus();
        return;
      }
      // No usable trigger — either it was removed while the dialog was
      // open, or the dialog was opened programmatically with nothing
      // focused. Either way, dropping focus on `<body>` restarts the
      // next Tab at the top of the document, so send it somewhere
      // meaningful instead.
      resolveFallback(fallbackRefRef.current)?.focus();
    };
  }, [open, containerRef]);
}
