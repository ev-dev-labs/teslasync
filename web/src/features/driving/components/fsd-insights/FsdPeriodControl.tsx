import { useCallback, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { FSD_PERIOD_DAYS, type FsdPeriodDays } from '@/types/fsd';

interface FsdPeriodControlProps {
  value: FsdPeriodDays;
  onChange: (days: FsdPeriodDays) => void;
  /** Disabled while no vehicle is selected — there is nothing to re-scope. */
  disabled?: boolean;
}

/**
 * 7 / 30 / 90 / 365-day period selector.
 *
 * Implements the WAI-ARIA radiogroup pattern (the same contract as
 * `components/forms/DensityToggle`), with the two behaviours a plain button
 * row gets wrong:
 *
 *   - **Roving tabIndex** — exactly one radio sits in the document tab order,
 *     so Tab enters and leaves the group in a single stop instead of walking
 *     four separate controls.
 *   - **Arrow / Home / End** — Left+Up move back, Right+Down move forward,
 *     both wrapping around; Home and End jump to the ends. Selection follows
 *     focus (the WAI-ARIA default for radiogroups) and focus is moved
 *     explicitly, because `aria-checked` alone does not tell the browser where
 *     the caret went.
 *
 * A disabled group is inert: it keeps its single tab stop but never re-scopes
 * the page, because a period change with no vehicle selected has nothing to
 * fetch.
 */
export function FsdPeriodControl({ value, onChange, disabled = false }: FsdPeriodControlProps) {
  const { t } = useTranslation();
  // A ref MAP rather than an array: React hands back `null` on unmount, and
  // deleting the entry keeps the map from retaining detached nodes.
  const refs = useRef(new Map<FsdPeriodDays, HTMLButtonElement>());

  const focusAndSelect = useCallback(
    (next: FsdPeriodDays) => {
      onChange(next);
      // Every option renders on every pass, so the node already exists — no
      // rAF hop needed, and staying inside the same event is what assistive
      // tech expects from arrow-key navigation.
      refs.current.get(next)?.focus();
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, current: FsdPeriodDays) => {
      if (disabled) return;
      const options = FSD_PERIOD_DAYS;
      const index = options.indexOf(current);
      if (index < 0) return;

      let next: FsdPeriodDays | undefined;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = options[(index + 1) % options.length];
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = options[(index - 1 + options.length) % options.length];
          break;
        case 'Home':
          next = options[0];
          break;
        case 'End':
          next = options[options.length - 1];
          break;
        default:
          return;
      }

      event.preventDefault();
      if (next != null) focusAndSelect(next);
    },
    [disabled, focusAndSelect],
  );

  return (
    <div
      role="radiogroup"
      aria-label={t('fsd.period.label', 'Analysis period')}
      data-testid="fsd-period-control"
      className="flex flex-wrap items-center gap-1.5"
    >
      {FSD_PERIOD_DAYS.map((days) => {
        const selected = days === value;
        return (
          <Button
            key={days}
            ref={(node) => {
              if (node) refs.current.set(days, node);
              else refs.current.delete(days);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t('fsd.period.optionAria', 'Last {{days}} days', { days })}
            // Roving tabIndex: the selected radio is the group's only tab stop.
            tabIndex={selected ? 0 : -1}
            variant={selected ? 'primary' : 'secondary'}
            size="md"
            disabled={disabled}
            onClick={() => onChange(days)}
            onKeyDown={(event) => handleKeyDown(event, days)}
            className={cn('min-h-11 min-w-16 tabular-nums', selected && 'font-semibold')}
          >
            {t('fsd.period.option', '{{days}}d', { days })}
          </Button>
        );
      })}
    </div>
  );
}
