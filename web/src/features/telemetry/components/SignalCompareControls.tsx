/**
 * SignalCompareControls — window inputs + presets + filter + category chips
 * for the signal-diff workflow.
 *
 * Pure controls (no data fetching, no diff table). Used inside both:
 *   - SignalDiffPage         (full-page compare)
 *   - SignalsWorkspacePage   (compare mode block)
 *
 * The 8 category prefixes and 5 datetime presets are exported so the
 * pages can also drive their server-side filter strings.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, Button, Input, HelpTooltip } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

export const CATEGORY_PREFIXES: Array<{ id: string; labelKey: string; defaultLabel: string; matches: (name: string) => boolean }> = [
  { id: 'battery',  labelKey: 'signalDiff.cat.battery',  defaultLabel: 'Battery',  matches: (n) => /battery|charge|soc|range|kwh/i.test(n) },
  { id: 'drive',    labelKey: 'signalDiff.cat.drive',    defaultLabel: 'Drive',    matches: (n) => /speed|odometer|gear|drive|brake|throttle|steering/i.test(n) },
  { id: 'climate',  labelKey: 'signalDiff.cat.climate',  defaultLabel: 'Climate',  matches: (n) => /climate|hvac|cabin|seat|temp/i.test(n) },
  { id: 'security', labelKey: 'signalDiff.cat.security', defaultLabel: 'Security', matches: (n) => /lock|sentry|alarm|valet|guard/i.test(n) },
  { id: 'motor',    labelKey: 'signalDiff.cat.motor',    defaultLabel: 'Motor',    matches: (n) => /motor|inverter|torque|rpm/i.test(n) },
  { id: 'tire',     labelKey: 'signalDiff.cat.tire',     defaultLabel: 'Tire',     matches: (n) => /tpms|tire|pressure/i.test(n) },
  { id: 'media',    labelKey: 'signalDiff.cat.media',    defaultLabel: 'Media',    matches: (n) => /media|audio|volume|playback/i.test(n) },
  { id: 'safety',   labelKey: 'signalDiff.cat.safety',   defaultLabel: 'Safety',   matches: (n) => /airbag|seatbelt|fcw|aeb|safety/i.test(n) },
];

export type DiffPresetId =
  | 'now-vs-1h'
  | 'now-vs-1d'
  | 'last-drive'
  | 'before-after-charge'
  | 'today-vs-yesterday';

interface DiffPreset {
  id: DiffPresetId;
  labelKey: string;
  defaultLabel: string;
  compute: () => { atA: Date; atB: Date };
}

export const DIFF_PRESETS: DiffPreset[] = [
  { id: 'now-vs-1h',           labelKey: 'signalDiff.preset.nowVs1h',           defaultLabel: 'Now vs 1h ago',                  compute: () => { const n = new Date(); return { atA: new Date(n.getTime() - 3600 * 1000), atB: n }; } },
  { id: 'now-vs-1d',           labelKey: 'signalDiff.preset.nowVs1d',           defaultLabel: 'Now vs 1 day ago',               compute: () => { const n = new Date(); return { atA: new Date(n.getTime() - 86400 * 1000), atB: n }; } },
  { id: 'before-after-charge', labelKey: 'signalDiff.preset.beforeAfterCharge', defaultLabel: 'Before vs after last charge',   compute: () => { const n = new Date(); return { atA: new Date(n.getTime() - 4 * 3600 * 1000), atB: n }; } },
  { id: 'last-drive',          labelKey: 'signalDiff.preset.lastDrive',         defaultLabel: 'Last drive start vs end',       compute: () => { const n = new Date(); return { atA: new Date(n.getTime() - 90 * 60 * 1000), atB: new Date(n.getTime() - 5 * 60 * 1000) }; } },
  { id: 'today-vs-yesterday',  labelKey: 'signalDiff.preset.todayVsYesterday',  defaultLabel: 'Today vs yesterday (same time)', compute: () => { const n = new Date(); return { atA: new Date(n.getTime() - 86400 * 1000), atB: n }; } },
];

export function toLocalDatetimeInput(date: Date): string {
  // Guard invalid / absent dates so a bad preset or upstream computation
  // renders as an empty window rather than the literal "NaN-NaN-NaNTNaN:NaN".
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoOrEmpty(localValue: string): string {
  if (!localValue) return '';
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export interface SignalCompareControlsProps {
  atA: string;
  atB: string;
  onChangeA: (value: string) => void;
  onChangeB: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string | null;
  onCategoryChange: (next: string | null) => void;
  /** Slot rendered on the row above the windows — vehicle picker, etc. */
  topSlot?: React.ReactNode;
  className?: string;
}

export function SignalCompareControls({
  atA,
  atB,
  onChangeA,
  onChangeB,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  topSlot,
  className,
}: SignalCompareControlsProps) {
  const { t } = useTranslation();

  const applyPreset = useCallback(
    (id: DiffPresetId) => {
      const preset = DIFF_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      const { atA: a, atB: b } = preset.compute();
      onChangeA(toLocalDatetimeInput(a));
      onChangeB(toLocalDatetimeInput(b));
    },
    [onChangeA, onChangeB],
  );

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5 space-y-4', className)}>
        {topSlot ? <div>{topSlot}</div> : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <span className="mb-1.5 flex items-center gap-1 text-xs text-cyan-300">
              {t('signalDiff.windowA', 'Window A')}
              <HelpTooltip
                i18nKey="help.signal.snapshot"
                defaultValue="A snapshot is a point-in-time view of every signal value at a single timestamp. Falls back to signal_log within the last 30 days when the live layer doesn't have it."
                ariaLabel={t('help.signal.snapshot.aria', { defaultValue: 'More info about signal snapshots' })}
              />
            </span>
            <Input
              type="datetime-local"
              value={atA}
              onChange={(e) => onChangeA(e.target.value)}
              aria-label={t('signalDiff.windowA', 'Window A')}
            />
          </div>
          <div>
            <span className="mb-1.5 flex items-center gap-1 text-xs text-amber-300">
              {t('signalDiff.windowB', 'Window B')}
              <HelpTooltip
                i18nKey="help.signal.diff"
                defaultValue="Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise."
                ariaLabel={t('help.signal.diff.aria', { defaultValue: 'More info about signal diffs' })}
              />
            </span>
            <Input
              type="datetime-local"
              value={atB}
              onChange={(e) => onChangeB(e.target.value)}
              aria-label={t('signalDiff.windowB', 'Window B')}
            />
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-labelledby="signal-compare-presets-label"
        >
          <span id="signal-compare-presets-label" className="text-xs text-[var(--text-muted)]">
            {t('signalDiff.presetsLabel', 'Quick presets:')}
          </span>
          {DIFF_PRESETS.map((p) => (
            <Button key={p.id} variant="secondary" size="sm" onClick={() => applyPreset(p.id)}>
              {t(p.labelKey, p.defaultLabel)}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            type="search"
            placeholder={t('signalDiff.filterPlaceholder', 'Filter signals…')}
            aria-label={t('signalDiff.filterLabel', 'Filter signals')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="max-w-sm"
          />
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t('signalDiff.categoryFilterLabel', 'Filter by category')}
          >
            {CATEGORY_PREFIXES.map((c) => {
              const active = category === c.id;
              return (
                <Button
                  key={c.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => onCategoryChange(active ? null : c.id)}
                  className={cn(
                    'h-auto rounded-full border px-2.5 py-1 text-xs uppercase tracking-wide',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]',
                    active
                      ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                  )}
                >
                  {t(c.labelKey, c.defaultLabel)}
                </Button>
              );
            })}
            {category ? (
              <Button variant="ghost" size="sm" onClick={() => onCategoryChange(null)}>
                {t('signalDiff.clearCategory', 'Clear')}
              </Button>
            ) : null}
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
