import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { DAYS } from '@/lib/constants';
import { safeNumber } from '@/lib/numberFormat';
import type { ChargingOptimizerData, OptimizerHeatmapEntry } from '@/types/charging';

interface CostHeatmapProps {
  heatmap: ChargingOptimizerData['weekly_heatmap'];
  peakCostPerKwh: number;
}

/** Hours of the day (0..23) — hoisted so the array identity is stable per render. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Legend stops (low → high cost) that sample the {@link heatFill} scale. */
const LEGEND_STOPS = [0.15, 0.3, 0.5, 0.7, 0.9] as const;

/** Default upper bound for the cost colour scale when no peak rate is known. */
const DEFAULT_MAX_COST = 0.3;

/**
 * Cost intensity (0 = cheap, 1 = expensive) → warm rgba fill at the given alpha.
 * The output is a data-driven value consumed by an inline `style` (dynamic
 * values are the sanctioned exception to the no-inline-style rule — a static
 * className cannot express a continuous scale). Both inputs are `safeNumber`-
 * guarded and clamped to [0, 1] so dirty upstream data (NaN, negatives,
 * out-of-range) can never emit an invalid colour string.
 */
export function heatFill(intensity: number, alpha: number): string {
  const t = Math.max(0, Math.min(1, safeNumber(intensity)));
  const a = Math.max(0, Math.min(1, safeNumber(alpha)));
  const r = Math.round(t * 239);
  const g = Math.round((1 - t) * 187);
  const b = Math.round((1 - t) * 100);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function CostHeatmap({ heatmap, peakCostPerKwh }: CostHeatmapProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const peak = safeNumber(peakCostPerKwh);
  const maxCost = peak > 0 ? peak : DEFAULT_MAX_COST;

  // O(1) cell lookup keyed by day*24+hour, rebuilt only when the heatmap
  // changes — replaces a 168× linear `find` scan over the entries array.
  const cellByKey = useMemo(() => {
    const map = new Map<number, OptimizerHeatmapEntry>();
    for (const entry of heatmap ?? []) {
      if (!entry) continue;
      map.set(safeNumber(entry.day) * 24 + safeNumber(entry.hour), entry);
    }
    return map;
  }, [heatmap]);

  const hasData = (heatmap ?? []).length > 0;
  const sessionsWord = t('charging.optimizer.sessionsWord', 'sessions');

  return (
    <GlassPanel className="p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Clock className="h-4 w-4 text-neon-purple" aria-hidden="true" />
        {t('charging.optimizer.heatmap', 'Charging Cost Heatmap')}
      </h3>
      {hasData ? (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div
              role="img"
              aria-label={t(
                'charging.optimizer.heatmapAlt',
                'Average charging cost per kWh by weekday and hour of day',
              )}
            >
              {/* Hour labels */}
              <div className="flex gap-0.5 ml-12 mb-1">
                {HOURS.map((i) => (
                  <div key={i} className="flex-1 text-center text-2xs text-[var(--text-muted)]">
                    {i % 3 === 0 ? `${i}` : ''}
                  </div>
                ))}
              </div>
              {/* Grid rows */}
              {DAYS.map((dayLabel, dayIdx) => (
                <div key={dayLabel} className="flex items-center gap-0.5 mb-0.5">
                  <span className="w-10 text-right text-2xs text-[var(--text-muted)] mr-1">{dayLabel}</span>
                  {HOURS.map((hourIdx) => {
                    const entry = cellByKey.get(dayIdx * 24 + hourIdx);
                    const sessions = Math.max(0, safeNumber(entry?.sessions));
                    const cost = Math.max(0, safeNumber(entry?.avg_cost_per_kwh));
                    const intensity = Math.min(1, cost / maxCost);
                    return (
                      <div
                        key={hourIdx}
                        className="flex-1 aspect-square rounded-sm"
                        style={{
                          backgroundColor: sessions > 0
                            ? heatFill(intensity, Math.min(0.9, 0.15 + sessions * 0.12))
                            : 'rgba(255,255,255,0.02)',
                        }}
                        title={sessions > 0
                          ? `${dayLabel} ${hourIdx}:00 — ${sessions} ${sessionsWord}, ${formatCurrency(cost, 3)}/kWh`
                          : `${dayLabel} ${hourIdx}:00`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-2 text-2xs text-[var(--text-muted)]">
              <span>{t('charging.optimizer.cheap', 'Cheap')}</span>
              <div className="flex gap-0.5" aria-hidden="true">
                {LEGEND_STOPS.map((o, i) => (
                  <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: heatFill(o, 0.6) }} />
                ))}
              </div>
              <span>{t('charging.optimizer.expensive', 'Expensive')}</span>
            </div>
          </div>
        </div>
      ) : (
        // no-action: transient — useChargingOptimizer keys weekly_heatmap off vehicleId only, so no page filter reset would populate it sooner.
        <EmptyState
          message={t(
            'charging.optimizer.heatmapEmpty',
            'The charging cost heatmap will appear after more charging sessions.',
          )}
        />
      )}
    </GlassPanel>
  );
}
