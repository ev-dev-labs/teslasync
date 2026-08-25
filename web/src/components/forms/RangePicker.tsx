/**
 * RangePicker — single-trigger date range filter.
 *
 * Replaces the inline `<DateRangeFilter>` (always-visible inputs + chips +
 * Apply button) with a compact trigger that opens a popover containing
 * preset list + 2-month calendar + optional comparison toggle.
 *
 * Behavior contract:
 *   - Preset click  → applies immediately, closes the popover, fires `onChange`.
 *   - Calendar pick → stages internally; only `Apply` fires `onChange`.
 *                     `Cancel` (or click-outside / Esc) discards the staged range.
 *   - Compare toggle → fires `onCompareChange` (uncontrolled siblings of `value`).
 *   - The trigger's accessible name updates as the active preset changes.
 *
 * Mobile: same trigger; the popover renders below md breakpoint as a
 * bottom-pinned sheet via the same Popover primitive. The internal layout
 * collapses to a single column.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/cn';
import {
  DATE_PRESETS,
  DEFAULT_PRESET_IDS,
  getDatePreset,
  matchPresetId,
  resolveAllTimeStart,
} from '@/lib/datePresets';

const LazyDayPicker = lazy(async () => {
  const module = await import('react-day-picker');
  return { default: module.DayPicker };
});

export interface RangePickerValue {
  start: string;
  end: string;
}

export interface RangePickerProps {
  /** Current ISO range (`YYYY-MM-DD` strings, inclusive). */
  value: RangePickerValue;
  /** Called whenever the range is committed (preset click or Apply). */
  onChange: (value: RangePickerValue, presetId?: string) => void;
  /** Subset of preset ids to render. Defaults to {@link DEFAULT_PRESET_IDS}. */
  presetIds?: readonly string[];
  /**
   * Floor for the "All time" preset and for any user-selectable date.
   * Pass the user's first data point for a smarter "All time" semantic.
   * Falls back to `2015-01-01`.
   */
  minDate?: string;
  /** Upper bound (inclusive) for selectable dates. Defaults to today. */
  maxDate?: string;
  /** When true, show "Compare to previous period" toggle in the footer. */
  enableCompare?: boolean;
  /** Current value of the compare flag. */
  compare?: boolean;
  /** Called when the compare toggle is flipped. */
  onCompareChange?: (next: boolean) => void;
  /** Trigger size matches Button size scale. */
  size?: 'sm' | 'md';
  /** Popover alignment relative to the trigger. */
  align?: 'start' | 'end';
  /** Optional className on the trigger element. */
  className?: string;
  /** Test id forwarded to the trigger. */
  triggerTestId?: string;
  /**
   * When true, hide the calendar grid and footer Apply/Cancel buttons.
   * Use this for pages whose backend only accepts trailing-period queries
   * (e.g. `?days=N`) and cannot honor an arbitrary custom range.
   */
  presetsOnly?: boolean;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateFromIso(s: string): Date {
  // Local-day construction so YYYY-MM-DD doesn't shift across timezones.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function diffDaysInclusive(start: string, end: string): number {
  const s = dateFromIso(start).getTime();
  const e = dateFromIso(end).getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

function formatRange(start: string, end: string, locale: string): string {
  const s = dateFromIso(start);
  const e = dateFromIso(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameDay = start === end;
  const fmt = (d: Date, withYear: boolean) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(d);
  if (sameDay) return fmt(s, true);
  return `${fmt(s, !sameYear)} – ${fmt(e, true)}`;
}

export function RangePicker({
  value,
  onChange,
  presetIds = DEFAULT_PRESET_IDS,
  minDate,
  maxDate,
  enableCompare = false,
  compare = false,
  onCompareChange,
  size = 'sm',
  align = 'start',
  className,
  triggerTestId,
  presetsOnly = false,
}: RangePickerProps) {
  const { t, i18n } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Staged range — what the calendar shows but hasn't applied yet.
  const [staged, setStaged] = useState<DateRange | undefined>(undefined);

  // Reset staged state on open.
  useEffect(() => {
    if (open) {
      setStaged({ from: dateFromIso(value.start), to: dateFromIso(value.end) });
    }
  }, [open, value.start, value.end]);

  const activePresetId = useMemo(
    () => matchPresetId(value.start, value.end),
    [value.start, value.end],
  );
  const activePreset = activePresetId ? getDatePreset(activePresetId) : undefined;
  const activeLabel = activePreset
    ? t(activePreset.i18nKey, activePreset.fallback)
    : t('date.range.pickRange', 'Custom range');

  const presets = useMemo(
    () => DATE_PRESETS.filter((p) => presetIds.includes(p.id)),
    [presetIds],
  );

  const handlePreset = (id: string) => {
    const preset = getDatePreset(id);
    if (!preset) return;
    const r =
      preset.id === 'all'
        ? { start: resolveAllTimeStart(minDate), end: preset.resolve().end }
        : preset.resolve();
    onChange(r, preset.id);
    setOpen(false);
  };

  const handleApply = () => {
    if (!staged?.from || !staged?.to) return;
    const start = isoFromDate(staged.from);
    const end = isoFromDate(staged.to);
    if (start > end) return;
    onChange({ start, end });
    setOpen(false);
  };

  const handleCancel = () => {
    setStaged(undefined);
    setOpen(false);
  };

  const stagedDirty =
    !!staged?.from &&
    !!staged?.to &&
    (isoFromDate(staged.from) !== value.start || isoFromDate(staged.to) !== value.end);

  const stagedDays =
    staged?.from && staged?.to
      ? diffDaysInclusive(isoFromDate(staged.from), isoFromDate(staged.to))
      : null;

  const triggerLabel = activeLabel;
  const triggerSubLabel = formatRange(value.start, value.end, i18n.language || 'en');
  const totalDays = diffDaysInclusive(value.start, value.end);
  const dayCount = t('date.range.summaryDays', '{{count}} days', { count: totalDays });

  const minDateObj = minDate ? dateFromIso(minDate) : undefined;
  const maxDateObj = maxDate ? dateFromIso(maxDate) : new Date();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('date.range.trigger', 'Date range')}
        title={`${triggerSubLabel} · ${dayCount}`}
        data-testid={triggerTestId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg ring-1 ring-white/[0.08] bg-white/[0.04] text-left',
          'hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          'forced-colors:border forced-colors:border-[ButtonBorder]',
          size === 'md' ? 'h-10 px-3 text-sm' : 'h-8 px-2.5 text-xs',
          className,
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        <span className="font-medium text-[var(--text-primary)] truncate">{triggerLabel}</span>
        <span className="text-[var(--text-muted)] hidden sm:inline truncate">· {triggerSubLabel}</span>
        <ChevronDown className="h-3 w-3 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align={align}
        ariaLabel={t('date.range.popoverLabel', 'Date range picker')}
        className="w-[min(96vw,640px)] p-0"
      >
        <div className="flex flex-col md:flex-row">
          {/* Preset list */}
          <ul
            className="flex md:flex-col gap-1 p-2 md:border-r md:border-[var(--glass-border)] overflow-x-auto md:overflow-visible md:w-[180px]"
            role="listbox"
            aria-label={t('date.preset.label', 'Quick date range')}
          >
            {presets.map((p) => {
              const active = p.id === activePresetId;
              return (
                <li key={p.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => handlePreset(p.id)}
                    className={cn(
                      'w-full text-left rounded-md px-3 py-1.5 text-xs whitespace-nowrap',
                      'hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                      active
                        ? 'bg-blue-600 text-[var(--text-on-accent)] hover:bg-blue-600'
                        : 'text-[var(--text-primary)]',
                    )}
                  >
                    {t(p.i18nKey, p.fallback)}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Calendar + footer */}
          {!presetsOnly && (
            <div className="flex flex-col flex-1 min-w-0">
              <div className="p-2">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-label={t('date.range.loadingCalendar', 'Loading calendar…')}
                      className="min-h-72 animate-pulse rounded-shape-md bg-[var(--surface-2)] motion-reduce:animate-none"
                    />
                  }
                >
                  <LazyDayPicker
                    mode="range"
                    selected={staged}
                    onSelect={setStaged}
                    numberOfMonths={typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1}
                    fromDate={minDateObj}
                    toDate={maxDateObj}
                    showOutsideDays={false}
                    className="rdp-tesla"
                    weekStartsOn={(i18n.language?.startsWith('en') ? 0 : 1) as 0 | 1}
                  />
                </Suspense>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                {enableCompare ? (
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={compare}
                      onChange={(e) => onCompareChange?.(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    {t('date.range.compare', 'Compare to previous period')}
                  </label>
                ) : (
                  <span className="text-2xs text-[var(--text-muted)]">
                    {stagedDays
                      ? t('date.range.summaryDays', '{{count}} days', { count: stagedDays })
                      : ''}
                  </span>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={handleCancel}>
                    {t('date.range.cancel', 'Cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={handleApply}
                    disabled={!stagedDirty}
                  >
                    {t('date.range.apply', 'Apply')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}
