/**
 * DatePresetChips — quick-select chip row for date ranges.
 *
 * Renders a row of `<Button>` chips, one per preset id. Calls `onSelect`
 * with the preset id and resolved {start, end} ISO date strings.
 *
 * Standalone — works inside `<DateRangeFilter>` or any custom date filter
 * (signal-log time window, alert history, etc.).
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { DEFAULT_PRESET_IDS, getDatePreset, type DatePreset } from '@/lib/datePresets';

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

  // Resolve the requested ids to presets, honouring the CALLER'S order and
  // de-duplicating while dropping unknown ids. The previous implementation
  // filtered DATE_PRESETS directly, which silently re-ordered chips to the
  // canonical preset order (ignoring the order the caller asked for) and
  // could not honour a custom sequence.
  const presets = useMemo<DatePreset[]>(() => {
    const seen = new Set<string>();
    const out: DatePreset[] = [];
    for (const id of presetIds ?? []) {
      if (seen.has(id)) continue;
      const preset = getDatePreset(id);
      if (!preset) continue;
      seen.add(id);
      out.push(preset);
    }
    return out;
  }, [presetIds]);

  const handleSelect = useCallback(
    (preset: DatePreset) => {
      const { start, end } = preset.resolve();
      onSelect({ id: preset.id, start, end });
    },
    [onSelect],
  );

  // Nothing resolvable to show → render nothing rather than an empty,
  // labelled group (an announced-but-empty group is a11y noise). Matches
  // the sibling <ActiveFilterChips> hide-when-empty convention.
  if (presets.length === 0) return null;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1', className)}
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
            onClick={() => handleSelect(p)}
            aria-pressed={active}
          >
            {t(p.i18nKey, p.fallback)}
          </Button>
        );
      })}
    </div>
  );
}
