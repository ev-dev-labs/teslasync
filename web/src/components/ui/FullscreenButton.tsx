/**
 * `<FullscreenButton>` primitive.
 *
 * Wraps the browser Fullscreen API (`requestFullscreen` /
 * `exitFullscreen` / `fullscreenchange`) behind a small reusable
 * button. Used by `<ChartContainer>` (toolbar slot) and by the
 * leaflet map adapter (`MapFullscreenControl`) so a single primitive
 * owns the support detection, state sync, and label-toggle logic.
 *
 * Contract
 * --------
 *   - `targetRef` MUST point at the element that will be made
 *     fullscreen. It can be an HTMLDivElement, HTMLElement, or any
 *     subtype — the button calls `requestFullscreen()` on the live
 *     ref value at click time.
 *   - The button hides itself entirely when
 *     `document.fullscreenEnabled` is false. There is no pseudo-
 *     fullscreen overlay fallback (see "Out of scope" in the prompt
 *     — Safari iOS limits documented + skipped).
 *   - State (`isFullscreen`) is sourced from the
 *     `fullscreenchange` event, NOT the click handler, so the
 *     button stays in sync when the user presses Esc to exit, when
 *     the browser revokes fullscreen due to a tab switch, or when
 *     a sibling component triggers fullscreen on the same target.
 *   - `aria-label`, `title`, and `aria-pressed` all flip together
 *     so screen-reader users + sighted-mouse users + assistive-tech
 *     all get a consistent enter/exit signal.
 */

import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface FullscreenButtonProps {
  /**
   * Ref to the element that should be made fullscreen. The ref's
   * `.current` is read at click-time — passing an empty ref renders
   * the button but no-ops the click.
   */
  targetRef: React.RefObject<HTMLElement | null>;
  /**
   * Override the "Enter fullscreen" accessible label. Defaults to
   * `t('common.fullscreen.enter', 'Enter fullscreen')`. Useful for
   * specialised contexts ("Expand chart", "Maximise map").
   */
  ariaLabelEnter?: string;
  /**
   * Override the "Exit fullscreen" accessible label. Defaults to
   * `t('common.fullscreen.exit', 'Exit fullscreen')`.
   */
  ariaLabelExit?: string;
  /**
   * Optional class merged onto the underlying `<Button>`. Default
   * sizing is the same compact 28×28 footprint used by the
   * ChartContainer toolbar buttons (annotation add / hide).
   */
  className?: string;
  /**
   * Forwarded to `<Button size>`. Defaults to `sm`. When `sm` is
   * used, an additional `!h-7 !w-7 !p-0` class is applied so the
   * button matches the existing chart toolbar density.
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Test seam — when defined, overrides the
   * `document.fullscreenEnabled` probe so unit tests can render
   * the button (or assert it is hidden) without monkey-patching
   * the document object every test.
   */
  testHookSupported?: boolean;
}

function probeSupport(): boolean {
  if (typeof document === 'undefined') return false;
  // The standard property is true on every modern desktop browser
  // (Chrome, Firefox, Edge). It is `false` on iOS Safari (no
  // element-level fullscreen) and inside sandboxed iframes that
  // omit `allow="fullscreen"`. Both cases legitimately disable
  // the feature so hiding the button is the right answer.
  return document.fullscreenEnabled === true;
}

function readFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement ?? null;
}

/**
 * `<FullscreenButton>`.
 *
 * Renders a single ghost icon-button that toggles the browser
 * fullscreen state on `targetRef.current`. See module doc for the
 * contract.
 */
export const FullscreenButton = forwardRef<HTMLButtonElement, FullscreenButtonProps>(
  function FullscreenButton(
    { targetRef, ariaLabelEnter, ariaLabelExit, className, size = 'sm', testHookSupported },
    ref,
  ) {
    const { t } = useTranslation();
    const [supported, setSupported] = useState<boolean>(() =>
      testHookSupported !== undefined ? testHookSupported : probeSupport(),
    );
    const [isFs, setIsFs] = useState<boolean>(false);

    useEffect(() => {
      if (testHookSupported !== undefined) {
        setSupported(testHookSupported);
        return;
      }
      setSupported(probeSupport());
    }, [testHookSupported]);

    useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      const sync = () => {
        const target = targetRef.current;
        const el = readFullscreenElement();
        // Treat the button as "fullscreen" both when our own target
        // is the fullscreen element AND when a descendant of the
        // target is (e.g. a child SVG inside the chart). The latter
        // matches what the user perceives — "this card is in
        // fullscreen mode" — and keeps the icon honest.
        const active =
          target != null && el != null && (el === target || target.contains(el));
        setIsFs(active);
      };
      sync();
      document.addEventListener('fullscreenchange', sync);
      return () => {
        document.removeEventListener('fullscreenchange', sync);
      };
    }, [targetRef]);

    const toggle = useCallback(async () => {
      const target = targetRef.current;
      if (!target) return;
      try {
        const current = readFullscreenElement();
        if (current && (current === target || target.contains(current))) {
          if (typeof document.exitFullscreen === 'function') {
            await document.exitFullscreen();
          }
          return;
        }
        if (current && typeof document.exitFullscreen === 'function') {
          // Some other element holds the fullscreen lock — release
          // it first so our `requestFullscreen()` call below isn't
          // rejected by the "already fullscreen elsewhere" guard.
          await document.exitFullscreen();
        }
        if (typeof target.requestFullscreen === 'function') {
          await target.requestFullscreen();
        }
      } catch (err) {
        // Browser denied (sandbox, missing user gesture, permission
        // policy). Silently noop — the visual button state has not
        // changed, so the user can simply try again.
        console.warn('FullscreenButton: requestFullscreen rejected', err);
      }
    }, [targetRef]);

    if (!supported) return null;

    const enterLabel = ariaLabelEnter ?? t('common.fullscreen.enter', 'Enter fullscreen');
    const exitLabel = ariaLabelExit ?? t('common.fullscreen.exit', 'Exit fullscreen');
    const label = isFs ? exitLabel : enterLabel;

    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size={size}
        className={cn(size === 'sm' ? '!h-7 !w-7 !p-0' : undefined, className)}
        icon={
          isFs ? (
            <Minimize className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize className="h-3.5 w-3.5" aria-hidden="true" />
          )
        }
        onClick={() => {
          void toggle();
        }}
        aria-label={label}
        aria-pressed={isFs}
        title={label}
        data-testid="fullscreen-button"
        data-fullscreen-state={isFs ? 'on' : 'off'}
      />
    );
  },
);
