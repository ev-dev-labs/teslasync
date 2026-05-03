import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
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

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function RateTimeline({ rates, chargeWindow }: RateTimelineProps) {
  const { t } = useTranslation();

  const maxRate = useMemo(() => {
    if (rates.length === 0) return 1;
    return Math.max(...rates.map(r => r.rate_cents));
  }, [rates]);

  const isInWindow = (hour: number) => {
    if (!chargeWindow) return false;
    const { startHour, endHour } = chargeWindow;
    if (startHour <= endHour) {
      return hour >= startHour && hour < endHour;
    }
    // Cross-midnight window
    return hour >= startHour || hour < endHour;
  };

  if (rates.length === 0) {
    return (
      <div className="text-center text-[var(--text-muted)] py-8">
        {t('chargePlanner.noRateData', 'No rate data available')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-500/40" />
          {t('chargePlanner.offPeak', 'Off-Peak')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-500/40" />
          {t('chargePlanner.midPeak', 'Mid-Peak')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500/40" />
          {t('chargePlanner.onPeak', 'On-Peak')}
        </span>
        {chargeWindow && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
            {t('chargePlanner.chargeWindow', 'Charge Window')}
          </span>
        )}
      </div>

      {/* 24-hour bar chart */}
      <div className="flex items-end gap-0.5 h-24">
        {rates.map((rate) => {
          const heightPct = maxRate > 0 ? (rate.rate_cents / maxRate) * 100 : 10;
          const inWindow = isInWindow(rate.hour);
          const baseColor = tierColors[rate.tier] ?? tierColors.unknown;

          return (
            <div
              key={rate.hour}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                <div className="bg-[var(--surface-overlay)] rounded px-2 py-1 text-xs whitespace-nowrap border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-primary)] font-medium">{formatHour(rate.hour)}</div>
                  <div className={cn(tierTextColors[rate.tier] ?? 'text-[var(--text-secondary)]')}>
                    {rate.rate_cents.toFixed(1)}¢/kWh
                  </div>
                </div>
              </div>

              {/* Bar */}
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all duration-200',
                  inWindow
                    ? 'bg-cyan-400/70 shadow-[0_0_12px_rgba(34,211,238,0.4)] ring-1 ring-cyan-400/50'
                    : baseColor,
                )}
                style={{ height: `${Math.max(heightPct, 5)}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex gap-0.5 text-[10px] text-[var(--text-muted)]">
        {rates.map((rate) => (
          <div key={rate.hour} className="flex-1 text-center">
            {rate.hour % 3 === 0 ? formatHour(rate.hour) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
