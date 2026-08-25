import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { Tooltip } from './Tooltip';

/**
 * Field-level `<HelpIcon>` help primitive.
 *
 * A tiny `(?)` icon you place next to a form `<Label>`. Hover, focus, or
 * tap reveals the explanatory text via the shared `<Tooltip>` (which
 * carries the inverted-surface contract, ARIA wiring, and dev-time text
 * colour guard).
 *
 * Differs from `<HelpTooltip>`:
 *   - HelpTooltip is page-level — used next to deeply technical metric
 *     titles like "Vampire Drain" or "Drive Score". Larger lucide
 *     `<HelpCircle>` (h-3.5+), often paired with a "Learn more" link.
 *   - HelpIcon is field-level — sized to sit inline next to a form
 *     `<Label>`, with a per-field aria-label so screen readers announce
 *     "Help for {{field}}" rather than the generic "More info".
 *
 * Accessibility:
 *   - `<button type="button">` so keyboard users can Tab into it.
 *   - `aria-label` defaults to `t('a11y.helpFor', { field })` — pass `for`
 *     to provide the field name; falls back to the generic
 *     `help.tooltip.iconLabel` when `for` is omitted.
 *   - Pressing `Escape` while the trigger is focused blurs it, which
 *     dismisses the focus-within tooltip so power users can quickly
 *     close help without reaching for the mouse.
 *   - Renders nothing when no `i18nKey` and no `content` are provided
 *     (keeps adopting call-sites from having to gate the icon themselves
 *     when a help string is conditionally absent).
 */
export interface HelpIconProps {
  /** i18n key for the help text (preferred over plain `content`). */
  i18nKey?: string;
  /** Default fallback when key is missing or for one-offs. */
  content?: string;
  /**
   * Used to attach the helper to a labelled control: id of the field.
   * Surfaces in the trigger's aria-label as "Help for {{for}}", and (when
   * provided) the tooltip body is exposed under the id `${for}-help` so
   * the field can reference it via `aria-describedby` if needed.
   */
  for?: string;
  /** Tooltip placement relative to the icon. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Override the trigger's aria-label entirely. */
  ariaLabel?: string;
  /** Extra classes for the trigger button. */
  className?: string;
}

export function HelpIcon({
  i18nKey,
  content,
  for: forId,
  side = 'top',
  ariaLabel,
  className,
}: HelpIconProps) {
  const { t } = useTranslation();
  const { preferences } = useProductPreferences();
  const text = i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '');

  // Render nothing when no help content is supplied — keeps callers from
  // having to gate the icon themselves when a help string is missing.
  if (!preferences.contextualHelp || !text) return null;

  const label =
    ariaLabel ??
    (forId
      ? t('a11y.helpFor', { field: forId, defaultValue: `Help for ${forId}` })
      : t('help.tooltip.iconLabel', { defaultValue: 'More info' }));

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      // Blurring the trigger collapses the focus-within tooltip without
      // disturbing the surrounding form's keyboard flow.
      event.currentTarget.blur();
    }
  };

  return (
    <Tooltip content={text} side={side} multiline>
      <button
        type="button"
        aria-label={label}
        aria-describedby={forId ? `${forId}-help` : undefined}
        data-help-for={forId}
        onKeyDown={handleKeyDown}
        className={cn(
          'ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full align-middle',
          'text-[var(--text-muted)] transition-colors',
          'hover:text-[var(--text-secondary)]',
          'focus:outline-none focus-visible:text-[var(--text-secondary)] focus-visible:ring-1 focus-visible:ring-[var(--text-secondary)]',
          className,
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

HelpIcon.displayName = 'HelpIcon';
