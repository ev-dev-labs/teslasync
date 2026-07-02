import { useId, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, HelpCircle } from 'lucide-react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/cn';
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden';

/**
 * Compact "?" icon that reveals an explanatory tooltip on hover, focus, or
 * touch tap. Use it next to non-obvious metric titles, settings labels, or
 * advanced concepts (e.g. "Vampire Drain", "Cooldown minutes").
 *
 * Built on Radix UI's headless {@link https://www.radix-ui.com/primitives/docs/components/tooltip Tooltip}
 * primitive (info variant). Radix owns the interaction plumbing we used to
 * hand-roll: portalled + collision-aware positioning (no more clipping inside
 * `overflow-hidden` panels), a Popper-anchored transform origin, Escape-to-
 * dismiss, `prefers-reduced-motion` awareness, and pointer/focus timing.
 *
 * Accessibility is layered deliberately, because a floating Radix tooltip only
 * associates itself with the trigger *while open* — which would drop the
 * always-on help affordance keyboard/AT users rely on:
 *
 *   1. A persistent {@link VisuallyHidden} `role="tooltip"` node holds the help
 *      text and is wired to the trigger via a stable `aria-describedby`, so a
 *      screen reader announces the help the instant the button is focused
 *      (not only once the visual bubble animates in). Radix's own `asChild`
 *      merge leaves our explicit `aria-describedby` intact.
 *   2. The visible Radix bubble is `aria-hidden` — it is a purely decorative
 *      mirror of (1), so assistive tech never hears the help twice and
 *      `getByRole('tooltip')` resolves to exactly one node.
 *   3. `learnMore` renders twice: a `tabIndex={-1}` decorative link inside the
 *      bubble for pointer users, and a focusable VisuallyHidden skip-link so
 *      keyboard users can Tab straight to it (revealed on focus) and AT can
 *      reach it — the visible copy stays out of the tab order to avoid a
 *      focusable-but-hidden trap.
 *
 * Touch: Radix Tooltip intentionally suppresses open-on-touch (a tooltip has
 * no hover on a touchscreen), so we drive `open` ourselves and toggle it from
 * `onPointerDown` for `touch`/`pen` — tap to reveal, tap again (or elsewhere)
 * to dismiss. Mouse hover / keyboard focus stay managed by Radix.
 */
export interface HelpTooltipProps {
  /** Plain text content (use `i18nKey` instead when localising). */
  text?: string;
  /** i18n key to translate. Pair with `defaultValue` for the English fallback. */
  i18nKey?: string;
  /** Fallback used when `i18nKey` is missing from the translation bundle. */
  defaultValue?: string;
  /** Tooltip placement relative to the trigger. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional "Learn more" link rendered below the body. Opens in a new tab. */
  learnMore?: { url: string; label?: string };
  /** Trigger icon size. */
  size?: 'xs' | 'sm' | 'md';
  /** Override the trigger icon (defaults to lucide `<HelpCircle>`). */
  children?: ReactNode;
  /** Extra classes for the trigger button. */
  className?: string;
  /**
   * ARIA label for the trigger. Defaults to a translated "More info" string;
   * override when the surrounding context already names what the tooltip is
   * about (e.g. "More info about vampire drain").
   */
  ariaLabel?: string;
}

const SIZE_CLASS: Record<NonNullable<HelpTooltipProps['size']>, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

export function HelpTooltip({
  text,
  i18nKey,
  defaultValue,
  placement = 'top',
  learnMore,
  size = 'sm',
  children,
  className,
  ariaLabel,
}: HelpTooltipProps) {
  const { t } = useTranslation();
  const descId = useId();
  const [open, setOpen] = useState(false);

  const resolved = i18nKey
    ? t(i18nKey, { defaultValue: defaultValue ?? '' })
    : (text ?? '');

  // Render nothing when no content is supplied — keeps consumers from having
  // to gate the tooltip themselves.
  if (!resolved) return null;

  const iconClass = SIZE_CLASS[size];
  const label = ariaLabel ?? t('help.tooltip.iconLabel', { defaultValue: 'More info' });
  const learnMoreLabel = learnMore
    ? (learnMore.label ?? t('common.learnMore', { defaultValue: 'Learn more' }))
    : '';

  // Radix Tooltip has no notion of touch (there is no hover on a touchscreen),
  // so it deliberately ignores the focus a tap grants. Drive `open` ourselves
  // for touch/pen pointers so a tap toggles the help bubble; mouse + keyboard
  // fall through to Radix's own hover/focus handling via `onOpenChange`.
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      setOpen((prev) => !prev);
    }
  };

  return (
    <TooltipPrimitive.Provider delayDuration={150} skipDelayDuration={300}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            // Persistent description → screen readers announce the help text on
            // focus, independent of the visual bubble's open state. Radix's
            // `asChild` prop-merge preserves this over its own open-scoped wiring.
            aria-describedby={descId}
            onPointerDown={handlePointerDown}
            className={cn(
              'inline-flex items-center justify-center align-middle',
              // `touch-target-overlay` grows the pointer hit region to ≥44×44px
              // via an invisible ::before while the glyph stays icon-sized —
              // WCAG 2.5.5 without disturbing the inline layout.
              'touch-target-overlay rounded-full text-[var(--text-muted)] transition-colors',
              'hover:text-[var(--text-secondary)]',
              'focus:outline-hidden focus-visible:text-[var(--text-secondary)] focus-visible:ring-1 focus-visible:ring-[var(--text-secondary)]',
              className,
            )}
          >
            {children ?? <HelpCircle className={iconClass} aria-hidden />}
          </button>
        </TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            // Decorative mirror of the persistent VisuallyHidden description
            // below — hidden from the a11y tree so the help is announced once.
            aria-hidden
            side={placement}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              'z-50 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-lg',
              'whitespace-normal max-w-[260px]',
              // Inverted surface for high contrast against the page in both
              // themes (light card in dark mode / dark card in light mode).
              'bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900',
              // Windows High Contrast: box-shadow is dropped and bg remaps to
              // Canvas, so pin a system border + opaque Canvas to keep the
              // bubble reading as a separate floating layer.
              'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]',
              // Scale from the Popper-computed anchor point for a natural reveal.
              'origin-[var(--radix-tooltip-content-transform-origin)]',
              'scale-in motion-reduce:animate-none will-change-transform',
            )}
          >
            <div className="text-2xs leading-snug">
              <p className="text-[var(--text-primary)]">{resolved}</p>
              {learnMore && (
                <a
                  href={learnMore.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Pointer-only affordance: keyboard/AT users reach the
                  // focusable skip-link mirror below, so keep this copy out of
                  // the tab order (it also lives inside an aria-hidden subtree).
                  tabIndex={-1}
                  className="mt-1 inline-flex items-center gap-1 text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
                >
                  {learnMoreLabel}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>

      {/*
        Persistent accessible description. Radix associates its floating bubble
        with the trigger only while open; this always-present node keeps the
        help discoverable via `aria-describedby` the moment the button is
        focused, and gives `role="tooltip"` semantics even while visually closed.
      */}
      <VisuallyHidden id={descId} role="tooltip">
        {resolved}
      </VisuallyHidden>

      {/*
        Keyboard/AT-reachable "Learn more". Skip-link pattern: hidden until it
        receives focus, then revealed as a small chip so a keyboard user can Tab
        to it. Mirrors the decorative (tabIndex=-1, aria-hidden) link inside the
        bubble that serves pointer users.
      */}
      {learnMore && (
        <VisuallyHidden
          as="a"
          focusable
          href={learnMore.url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus:z-50 focus:inline-flex focus:items-center focus:gap-1 focus:rounded-md focus:bg-[var(--surface-1)] focus:px-2 focus:py-1 focus:text-2xs focus:font-medium focus:text-[var(--text-primary)] focus:shadow-lg focus:ring-1 focus:ring-[var(--glass-border)]"
        >
          {learnMoreLabel}
        </VisuallyHidden>
      )}
    </TooltipPrimitive.Provider>
  );
}
