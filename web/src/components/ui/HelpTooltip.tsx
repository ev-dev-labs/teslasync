import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, HelpCircle } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { Tooltip } from './Tooltip';

/**
 * Compact "?" icon that reveals an explanatory tooltip on hover, focus, or
 * touch tap. Use it next to non-obvious metric titles, settings labels, or
 * advanced concepts (e.g. "Vampire Drain", "Cooldown minutes").
 *
 * Composes the shared `<Tooltip>` so it inherits placement, ARIA wiring
 * (`role="tooltip"` + `aria-describedby` on the trigger), keyboard focus
 * support, and `prefers-reduced-motion` handling.
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
  const { preferences } = useProductPreferences();

  const resolved = i18nKey
    ? t(i18nKey, { defaultValue: defaultValue ?? '' })
    : (text ?? '');

  // Render nothing when no content is supplied — keeps consumers from having
  // to gate the tooltip themselves.
  if (!preferences.contextualHelp || !resolved) return null;

  const iconClass = SIZE_CLASS[size];
  const label = ariaLabel ?? t('help.tooltip.iconLabel', { defaultValue: 'More info' });

  const tooltipBody = (
    <span className="block text-2xs leading-snug">
      <span className="block text-[var(--text-primary)]">{resolved}</span>
      {learnMore && (
        <a
          href={learnMore.url}
          target="_blank"
          rel="noopener noreferrer"
          // Keep the link interactive even though Tooltip body is
          // pointer-events-none by default — re-enable it just for the link
          // so users can actually click "Learn more" before the tooltip
          // closes (focus stays inside the wrapper while pointer is over
          // the new-tab link).
          className="pointer-events-auto mt-1 inline-flex items-center gap-1 text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
        >
          {learnMore.label ?? t('common.learnMore', { defaultValue: 'Learn more' })}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </span>
  );

  return (
    <Tooltip content={tooltipBody} side={placement} multiline>
      <button
        type="button"
        aria-label={label}
        // Focusable button → tooltip works for keyboard users (Tab/Enter)
        // and touch users (tap focuses the button → :focus-within reveals
        // the tooltip; tapping elsewhere blurs and dismisses it).
        className={cn(
          'inline-flex items-center justify-center align-middle',
          'rounded-full text-[var(--text-muted)] transition-colors',
          'hover:text-[var(--text-secondary)]',
          'focus:outline-none focus-visible:text-[var(--text-secondary)] focus-visible:ring-1 focus-visible:ring-[var(--text-secondary)]',
          className,
        )}
      >
        {children ?? <HelpCircle className={iconClass} aria-hidden />}
      </button>
    </Tooltip>
  );
}
