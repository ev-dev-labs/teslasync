/**
 * DatePresetChips — quick-select chip row for date ranges.
 *
 * Renders a row of `<Button>` chips, one per preset id. Calls `onSelect`
 * with the preset id and resolved {start, end} ISO date strings.
 *
 * Standalone — works inside `<DateRangeFilter>` or any custom date filter
 * (signal-log time window, alert history, etc.).
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { DATE_PRESETS, DEFAULT_PRESET_IDS } from '@/lib/datePresets';

export interface DatePresetSelection {
  id: string;
  start: string;
  end: string;
}

export interface DatePresetChipsProps {
  /** Subset of preset ids to render. Defaults to {@link DEFAULT_PRESET_IDS}. */
  presetIds?: readonly string[];
  /** Optional id of the currently active preset (for highlight). */
  activeId?: string;
  /** Called when a chip is clicked. */
  onSelect: (selection: DatePresetSelection) => void;
  /** Chip size — matches the shared Button size scale. */
  size?: 'sm' | 'md';
  /** Optional override for the group's accessible name. */
  ariaLabel?: string;
  /** Pass-through className for the wrapping flex row. */
  className?: string;
}

export function DatePresetChips({
  presetIds = DEFAULT_PRESET_IDS,
  activeId,
  onSelect,
  size = 'sm',
  ariaLabel,
  className,
}: DatePresetChipsProps) {
  const { t } = useTranslation();
  const ids = new Set(presetIds);
  const presets = DATE_PRESETS.filter(p => ids.has(p.id));

  return (
    <div
      className={['flex flex-wrap items-center gap-1', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={ariaLabel ?? t('date.preset.label', 'Quick date range')}
    >
      {presets.map(p => {
        const active = p.id === activeId;
        return (
          <Button
            key={p.id}
            type="button"
            size={size}
            variant={active ? 'primary' : 'ghost'}
            onClick={() => {
              const r = p.resolve();
              onSelect({ id: p.id, start: r.start, end: r.end });
            }}
            aria-pressed={active}
          >
            {t(p.i18nKey, p.fallback)}
          </Button>
        );
      })}
    </div>
  );
}
