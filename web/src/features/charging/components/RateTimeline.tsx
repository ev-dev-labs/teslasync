import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';
import { Text } from '@/components/ui';
import { typography } from '@/lib/tokens';
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
  unknown: 'bg-[var(--surface-2)]',
};

const tierTextColors: Record<string, string> = {
  OFF_PEAK: 'text-emerald-400',
  SUPER_OFF_PEAK: 'text-emerald-300',
  MID_PEAK: 'text-amber-400',
  ON_PEAK: 'text-red-400',
  unknown: 'text-[var(--text-muted)]',
};

// Human-readable, translatable names for each known TOU tier. Used to build the
// per-bar accessible label so screen-reader users get the tier meaning that
// sighted users read from the bar colour (colour is never the only indicator).
const tierLabels: Record<string, { key: string; def: string }> = {
  OFF_PEAK: { key: 'chargePlanner.offPeak', def: 'Off-Peak' },
  SUPER_OFF_PEAK: { key: 'chargePlanner.superOffPeak', def: 'Super Off-Peak' },
  MID_PEAK: { key: 'chargePlanner.midPeak', def: 'Mid-Peak' },
  ON_PEAK: { key: 'chargePlanner.onPeak', def: 'On-Peak' },
};

function formatHour(h: number): string {
  if (!Number.isFinite(h)) return '—';
  // Normalise into 0..23 so a stray 24 (midnight) or out-of-range hour never
  // yields labels like "13p"/"NaNp".
  const hour = ((Math.trunc(h) % 24) + 24) % 24;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function RateTimeline({ rates, chargeWindow }: RateTimelineProps) {
  const { t } = useTranslation();

  // Defensive: callers already pass `hourly_rates ?? []`, but guard here too so
  // an undefined prop can never crash on `.length` / `.map`.
  const safeRates = rates ?? [];

  const maxRate = useMemo(() => {
    // Ignore non-finite rates (missing / NaN values from the API) when finding
    // the peak — otherwise a single bad value turns `Math.max` into NaN, which
    // silently collapses EVERY bar to the fallback height.
    const values = safeRates
      .map((r) => r.rate_cents)
      .filter((v): v is number => Number.isFinite(v));
    if (values.length === 0) return 1;
    const max = Math.max(...values);
    return max > 0 ? max : 1;
  }, [safeRates]);

  const isInWindow = (hour: number) => {
    if (!chargeWindow) return false;
    const { startHour, endHour } = chargeWindow;
    if (startHour <= endHour) {
      return hour >= startHour && hour < endHour;
    }
    // Cross-midnight window
    return hour >= startHour || hour < endHour;
  };

  if (safeRates.length === 0) {
    return (
      <Text as="div" size="sm" color="muted" className="text-center py-8">
        {t('chargePlanner.noRateData', 'No rate data available')}
      </Text>
    );
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-3 h-3 rounded-sm bg-emerald-500/40" />
          <Text variant="bodySm">{t('chargePlanner.offPeak', 'Off-Peak')}</Text>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-3 h-3 rounded-sm bg-amber-500/40" />
          <Text variant="bodySm">{t('chargePlanner.midPeak', 'Mid-Peak')}</Text>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-3 h-3 rounded-sm bg-red-500/40" />
          <Text variant="bodySm">{t('chargePlanner.onPeak', 'On-Peak')}</Text>
        </span>
        {chargeWindow && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3 h-3 rounded-sm bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
            <Text variant="bodySm">{t('chargePlanner.chargeWindow', 'Charge Window')}</Text>
          </span>
        )}
      </div>

      {/* 24-hour bar chart */}
      <div
        role="group"
        aria-label={t('chargePlanner.rateTimelineChart', '24-hour electricity rate timeline')}
        className="flex items-end gap-0.5 h-24"
      >
        {safeRates.map((rate, index) => {
          const rateCents = safeNumber(rate.rate_cents);
          const heightPct = maxRate > 0 ? (rateCents / maxRate) * 100 : 10;
          // Floor at 5% so a zero/near-zero rate is still a visible sliver, and
          // clamp at 100% so a rounding overshoot never overflows the track.
          const barHeight = Math.min(Math.max(heightPct, 5), 100);
          const inWindow = isInWindow(rate.hour);
          const baseColor = tierColors[rate.tier] ?? tierColors.unknown;

          const tierMeta = tierLabels[rate.tier];
          const tierName = tierMeta
            ? t(tierMeta.key, tierMeta.def)
            : rate.tier || t('chargePlanner.unknownTier', 'Unknown');
          const labelVars = {
            hour: formatHour(rate.hour),
            rate: fmtNumber(rate.rate_cents, 1),
            tier: tierName,
          };
          const barLabel = inWindow
            ? t('chargePlanner.rateBarLabelInWindow', '{{hour}}: {{rate}}¢ per kWh, {{tier}}, in charge window', labelVars)
            : t('chargePlanner.rateBarLabel', '{{hour}}: {{rate}}¢ per kWh, {{tier}}', labelVars);

          return (
            <div
              key={`${rate.hour}-${index}`}
              role="img"
              aria-label={barLabel}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              {/* Tooltip on hover — decorative; the same data is in aria-label. */}
              <div aria-hidden="true" className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                <div className="bg-[var(--surface-overlay)] rounded px-2 py-1 whitespace-nowrap border border-[var(--border-subtle)]">
                  <Text as="div" size="xs" weight="medium" color="primary">
                    {formatHour(rate.hour)}
                  </Text>
                  <Text
                    as="div"
                    size="xs"
                    className={cn(tierTextColors[rate.tier] ?? typography.color.secondary)}
                  >
                    {fmtNumber(rate.rate_cents, 1)}¢/kWh
                  </Text>
                </div>
              </div>

              {/* Bar */}
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all duration-normal',
                  inWindow
                    ? 'bg-cyan-400/70 shadow-[0_0_12px_rgba(34,211,238,0.4)] ring-1 ring-cyan-400/50'
                    : baseColor,
                )}
                style={{ height: `${barHeight}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Hour labels — decorative axis; per-bar aria-labels already carry the hour. */}
      <div className="flex gap-0.5" aria-hidden="true">
        {safeRates.map((rate, index) => (
          <Text
            as="div"
            key={`label-${rate.hour}-${index}`}
            size="2xs"
            color="muted"
            className="flex-1 text-center"
          >
            {rate.hour % 3 === 0 ? formatHour(rate.hour) : ''}
          </Text>
        ))}
      </div>
    </div>
  );
}
