import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { HourlyRate } from '@/types/charging';

interface RateTimelineProps {
  rates: HourlyRate[];
  chargeWindow?: { startHour: number; endHour: number };
}

const tierColors: Record<string, string> = {
  OFF_PEAK: 'bg-emerald-500/40',
  SUPER_OFF_PEAK: 'bg-emerald-500/50',
  MID_PEAK: 'bg-amber-500/40',
  ON_PEAK: 'bg-red-500/40',
  unknown: 'bg-[var(--surface-3)]',
};

const tierLabels: Record<string, { key: string; def: string }> = {
  OFF_PEAK: { key: 'chargePlanner.offPeak', def: 'Off-Peak' },
  SUPER_OFF_PEAK: { key: 'chargePlanner.superOffPeak', def: 'Super Off-Peak' },
  MID_PEAK: { key: 'chargePlanner.midPeak', def: 'Mid-Peak' },
  ON_PEAK: { key: 'chargePlanner.onPeak', def: 'On-Peak' },
};

function formatHour(h: number): string {
  if (!Number.isFinite(h)) return '—';
  const hour = ((Math.trunc(h) % 24) + 24) % 24;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Preserves tariff tiers, wall-clock hours and cross-midnight highlighting. */
export function RateTimeline({ rates, chargeWindow }: RateTimelineProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const rows = safeArray(rates);
  const maxRate = useMemo(() => {
    const values = safeArray(rates)
      .map(rate => knownNumber(rate.rate_cents))
      .filter((value): value is number => value != null);
    const peak = values.length ? Math.max(...values) : 1;
    return peak > 0 ? peak : 1;
  }, [rates]);

  const isInWindow = (hour: number) => {
    if (!chargeWindow) return false;
    const { startHour, endHour } = chargeWindow;
    return startHour <= endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour;
  };

  if (rows.length === 0) {
    return <Text as="div" size="sm" color="muted" className="py-8 text-center">
      {t('chargePlanner.noRateData', 'No rate data available')}
    </Text>;
  }

  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-3">
      <div className="flex flex-wrap gap-3">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-emerald-500/40" />
          <Text variant="bodySm">{t('chargePlanner.offPeak', 'Off-Peak')}</Text>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-amber-500/40" />
          <Text variant="bodySm">{t('chargePlanner.midPeak', 'Mid-Peak')}</Text>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-red-500/40" />
          <Text variant="bodySm">{t('chargePlanner.onPeak', 'On-Peak')}</Text>
        </span>
        {chargeWindow && <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-[var(--theme-primary)]/60" />
          <Text variant="bodySm">{t('chargePlanner.chargeWindow', 'Charge Window')}</Text>
        </span>}
      </div>

      <div role="group"
        aria-label={t('chargePlanner.rateTimelineChart', '24-hour electricity rate timeline')}
        className="flex h-24 items-end gap-0.5">
        {rows.map((rate, index) => {
          const value = knownNumber(rate.rate_cents);
          const barHeight = value == null ? 0 : Math.min(Math.max(value / maxRate * 100, 5), 100);
          const inWindow = isInWindow(rate.hour);
          const meta = tierLabels[rate.tier];
          const tierName = meta ? t(meta.key, meta.def)
            : rate.tier || t('chargePlanner.unknownTier', 'Unknown');
          const vars = { hour: formatHour(rate.hour), rate: value == null ? '—' : fmtNumber(value), tier: tierName };
          const label = inWindow
            ? t('chargePlanner.rateBarLabelInWindow', '{{hour}}: {{rate}}¢ per kWh, {{tier}}, in charge window', vars)
            : t('chargePlanner.rateBarLabel', '{{hour}}: {{rate}}¢ per kWh, {{tier}}', vars);
          return (
            <div key={`${rate.hour}-${index}`} role="img" aria-label={label} title={label}
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <div aria-hidden="true" className="absolute bottom-full z-10 mb-1 hidden group-hover:block">
                <div className="whitespace-nowrap rounded border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-2 py-1">
                  <Text as="div" size="xs" weight="medium" color="primary">{formatHour(rate.hour)}</Text>
                  <Text as="div" size="xs" color="secondary">{value == null ? '—' : `${fmtNumber(value)}¢/kWh`}</Text>
                </div>
              </div>
              <div className={cn('w-full rounded-t-sm',
                inWindow ? 'bg-[var(--theme-primary)]/60 ring-1 ring-[var(--theme-primary)]/30'
                  : tierColors[rate.tier] ?? tierColors.unknown)}
                style={{ height: `${barHeight}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {rows.map((rate, index) => (
          <Text as="div" key={`label-${rate.hour}-${index}`} size="2xs" color="muted"
            className="min-w-0 flex-1 text-center">
            {rate.hour % 3 === 0 ? formatHour(rate.hour) : ''}
          </Text>
        ))}
      </div>
    </div>
  );
}
