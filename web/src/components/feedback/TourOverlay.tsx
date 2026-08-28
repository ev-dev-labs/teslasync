import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/runtime';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';
import type { TourStep } from '@/hooks/useTour';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { isFocusRestorable } from '@/hooks/useDialogFocus';

interface TourOverlayProps {
  step: TourStep;
  targetRect: DOMRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

export function TourOverlay({
  step, targetRect, currentStep, totalSteps,
  onNext, onPrev, onSkip,
}: TourOverlayProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  /**
   * A11y — announcement without a focus trap.
   *
   * This is a NON-modal spotlight (`aria-modal="false"`): the whole point is
   * that the highlighted element stays reachable, so trapping focus inside the
   * tooltip would defeat the feature and strand keyboard users away from the
   * thing being explained.
   *
   * What it does instead: move focus to the tooltip container when it appears
   * AND on every step change. Focus is the announcement mechanism here — a
   * screen reader reads the container's accessible name (`aria-labelledby` →
   * the step heading) and description (`aria-describedby` → the step body) on
   * arrival, so each step is announced exactly once without an `aria-live`
   * region fighting the tour's own DOM updates.
   *
   * ## Why `hasTooltip` is in the dependency list
   *
   * In production this component mounts with `targetRect === null` — `useTour`
   * measures the spotlight target in an effect *after* the first render — so
   * the component early-returns and there is no tooltip yet. An effect keyed
   * on `[currentStep]` alone therefore ran once against a null ref, no-oped,
   * and never re-ran when the rect arrived (the step had not changed). Result:
   * step 1 was never announced, and only steps 2..n worked. Tests that passed
   * a rect on first render could not see this.
   *
   * Keying on tooltip *availability* rather than on `targetRect` itself is
   * deliberate: the rect object is replaced on every scroll and resize, so
   * depending on it would yank focus back to the tooltip continuously while
   * the user scrolls. A boolean only flips when the tooltip appears or
   * disappears.
   */
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const hasTooltip = targetRect !== null;
  useEffect(() => {
    if (previouslyFocusedRef.current === null) {
      const active = document.activeElement as HTMLElement | null;
      // Never record the tooltip itself as the restore target (it is about to
      // be focused), and never record `<body>` — restoring to body restarts
      // the next Tab at the top of the document.
      if (active && active !== document.body && !tooltipRef.current?.contains(active)) {
        previouslyFocusedRef.current = active;
      }
    }
    if (!hasTooltip) return;
    tooltipRef.current?.focus();
  }, [currentStep, hasTooltip]);

  /**
   * Restore focus on teardown (finish, skip, or unmount).
   *
   * Runs once, on unmount only — a per-step restore would fight the per-step
   * focus effect above. Mirrors the fallback chain used by `useDialogFocus`
   * without importing its trap: the trigger if it survived, otherwise the
   * route heading, otherwise `<main>`.
   */
  useEffect(() => {
    return () => {
      const previous = previouslyFocusedRef.current;
      if (isFocusRestorable(previous)) {
        previous.focus();
        return;
      }
      const routeHeading = document.querySelector<HTMLElement>('[data-route-focus-target]');
      if (isFocusRestorable(routeHeading)) {
        routeHeading.focus();
        return;
      }
      const main = document.querySelector<HTMLElement>('main');
      if (isFocusRestorable(main)) main.focus();
    };
  }, []);

  // Keyboard operability: Esc dismisses the tour, matching the close
  // button and the backdrop click. The listener is only registered while
  // the overlay is mounted (i.e. while the tour is active).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSkip]);

  if (!targetRect) return null;

  const spotlightPadding = 6;

  const spotlight = {
    top: targetRect.top - spotlightPadding,
    left: targetRect.left - spotlightPadding,
    width: targetRect.width + spotlightPadding * 2,
    height: targetRect.height + spotlightPadding * 2,
  };

  const tooltipStyle = getTooltipPosition(step.placement, targetRect);

  return (
    // Not a <Modal>: this is a full-screen tour spotlight with a transparent target cutout.
    // Has no scroll body, no dismiss chrome, and uses a clip-path for the
    // spotlight effect. New interactive dialogs MUST use <Modal>.
    // eslint-disable-next-line no-restricted-syntax
    <div className="fixed inset-0 z-[10000]" data-tour-active="true">
      {/* Dark overlay with spotlight cutout */}
      <div
        className={cn(
          'absolute inset-0 bg-[var(--surface-overlay)]',
          reduce ? '' : 'transition-all duration-normal',
        )}
        style={{
          clipPath: `polygon(
            0% 0%, 0% 100%,
            ${spotlight.left}px 100%,
            ${spotlight.left}px ${spotlight.top}px,
            ${spotlight.left + spotlight.width}px ${spotlight.top}px,
            ${spotlight.left + spotlight.width}px ${spotlight.top + spotlight.height}px,
            ${spotlight.left}px ${spotlight.top + spotlight.height}px,
            ${spotlight.left}px 100%,
            100% 100%, 100% 0%
          )`,
        }}
        onClick={onSkip}
        data-testid="tour-backdrop"
      />

      {/* Spotlight border glow */}
      <div
        className={cn(
          'absolute rounded-lg border-2 border-[var(--theme-primary)]/40',
          'shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.2)] pointer-events-none',
          reduce ? '' : 'transition-all duration-normal',
        )}
        style={{
          top: spotlight.top,
          left: spotlight.left,
          width: spotlight.width,
          height: spotlight.height,
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={cn(
          'absolute max-w-sm p-4 rounded-xl bg-[var(--bg-secondary)]',
          'border border-[var(--border-subtle)] shadow-2xl backdrop-blur-xl',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
          reduce ? '' : 'animate-in fade-in slide-in-from-bottom-2 duration-normal',
        )}
        style={tooltipStyle}
        role="dialog"
        // Non-modal by design: the spotlight target must stay reachable, so
        // assistive tech is explicitly told the rest of the page is NOT inert.
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descId}
        // Programmatically focusable but not a tab stop of its own — focus
        // arrives here on open and on each step change, then Tab proceeds
        // naturally into the tooltip's own controls.
        tabIndex={-1}
        data-testid="tour-tooltip"
      >
        {/* Close button — 44px touch target for mobile */}
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-1 right-1 p-2.5 rounded-md text-[var(--text-muted)]
            hover:text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors
            min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={t('tour.close', 'Close tour')}
          data-testid="tour-close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Step counter */}
        <div className="text-2xs text-[var(--text-muted)] mb-1" data-testid="tour-counter">
          {currentStep + 1} / {totalSteps}
        </div>

        {/* Content.
            The heading is an <h2> rather than an <h4>: it is the accessible
            name of the dialog, and a screen-reader user navigating by heading
            level must not have to skip two levels to reach it. Visual size is
            set by the class, not by the tag. */}
        <h2
          id={titleId}
          className="text-sm font-semibold text-[var(--text-primary)] mb-1"
          data-testid="tour-title"
        >
          {step.title}
        </h2>
        <p
          id={descId}
          className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4"
          data-testid="tour-description"
        >
          {step.description}
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors
              py-2.5 px-2 min-h-[44px] flex items-center"
            data-testid="tour-skip"
          >
            {t('tour.skip', 'Skip tour')}
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={onPrev}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                {t('tour.prev', 'Back')}
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {currentStep === totalSteps - 1
                ? t('tour.finish', 'Get Started!')
                : t('tour.next', 'Next')}
              {currentStep < totalSteps - 1 && (
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              )}
            </Button>
          </div>
        </div>

        {/* Progress dots — decorative; the "N / M" counter and the dialog
            aria-label already convey progress to assistive tech, so the dot
            row is hidden from the accessibility tree. Completed dots use a
            dimmed theme colour so they read differently from upcoming dots. */}
        <div
          className="flex justify-center gap-1 mt-3"
          data-testid="tour-progress"
          aria-hidden="true"
        >
          {Array.from({ length: totalSteps }).map((_, i) => {
            const state = i === currentStep ? 'current' : i < currentStep ? 'done' : 'upcoming';
            return (
              <div
                key={i}
                data-state={state}
                className={cn(
                  'h-1 rounded-full',
                  reduce ? '' : 'transition-all',
                  state === 'current'
                    ? 'w-4 bg-[var(--theme-primary)]'
                    : state === 'done'
                      ? 'w-1.5 bg-[var(--theme-primary)]/40'
                      : 'w-1.5 bg-[var(--surface-2)]',
                )}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function getTooltipPosition(
  placement: string,
  rect: DOMRect,
): React.CSSProperties {
  const gap = 16;
  const pad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(360, vw - pad * 2);
  const bottomNav = 72; // mobile bottom tab bar height

  const clampLeft = (x: number) =>
    Math.max(pad, Math.min(x, vw - maxW - pad));
  const clampTop = (y: number) =>
    Math.max(pad, Math.min(y, vh - bottomNav - 160));

  switch (placement) {
    case 'bottom':
      return { top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW };
    case 'top':
      return { bottom: Math.max(pad + bottomNav, vh - rect.top + gap), left: clampLeft(rect.left), maxWidth: maxW };
    case 'right':
      return { top: clampTop(rect.top), left: clampLeft(rect.right + gap), maxWidth: maxW };
    case 'left':
      return { top: clampTop(rect.top), right: Math.max(pad, vw - rect.left + gap), maxWidth: maxW };
    default:
      return { top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW };
  }
}
