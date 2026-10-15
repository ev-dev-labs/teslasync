import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Clock } from 'lucide-react';
import { Accordion, Caption, GlassPanel, PanelTitle, Table } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { DAYS } from '@/lib/constants';
import { safeNumber } from '@/lib/numberFormat';
import type { ChargingOptimizerData, OptimizerHeatmapEntry } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';

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
 * Cost intensity (0 = cheap, 1 = expensive) → theme-aware fill at the given alpha.
 * The output is a data-driven value consumed by an inline `style` (dynamic
 * values are the sanctioned exception to the no-inline-style rule — a static
 * className cannot express a continuous scale). Both inputs are `safeNumber`-
 * guarded and clamped to [0, 1] so dirty upstream data (NaN, negatives,
 * out-of-range) can never emit an invalid colour string.
 */
export function heatFill(intensity: number, alpha: number): string {
  const t = Math.max(0, Math.min(1, safeNumber(intensity)));
  const a = Math.max(0, Math.min(1, safeNumber(alpha)));
  const scale = `color-mix(in srgb, ${chartTokens.series[1]} ${(1 - t) * 100}%, ${chartTokens.series[3]})`;
  return `color-mix(in srgb, ${scale} ${a * 100}%, var(--surface-2))`;
}

export function CostHeatmap({ heatmap, peakCostPerKwh }: CostHeatmapProps) {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
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
  }, [heatmap, displayPrecision, displayLocale]);

  const hasData = (heatmap ?? []).length > 0;
  const sessionsWord = t('charging.optimizer.sessionsWord', 'sessions');
  const title = t('charging.optimizer.heatmap', 'Charging Cost Heatmap');
  const chartLabel = t('charging.optimizer.heatmapAlt', 'Average charging cost per kWh by weekday and hour of day');

  return (
    <GlassPanel className="min-w-0 max-w-full p-4 sm:p-6">
      <PanelTitle as="h3" className="mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {title}
      </PanelTitle>
      {hasData ? (
        <>
        <div
          role="region"
          aria-label={chartLabel}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Allows keyboard users to scroll the chart region.
          tabIndex={0}
          className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain p-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <div className="min-w-[600px]">
            <div
              role="img"
              aria-label={chartLabel}
            >
              {/* Hour labels */}
              <div className="flex gap-0.5 ml-12 mb-1">
                {HOURS.map((i) => (
                  <Caption key={i} className="flex-1 text-center">
                    {i % 3 === 0 ? `${i}` : ''}
                  </Caption>
                ))}
              </div>
              {/* Grid rows */}
              {DAYS.map((dayLabel, dayIdx) => (
                <div key={dayLabel} className="flex items-center gap-0.5 mb-0.5">
                  <Caption className="w-10 shrink-0 text-right mr-1">{dayLabel}</Caption>
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
                            : 'var(--surface-2)',
                        }}
                        title={sessions > 0
                          ? `${dayLabel} ${hourIdx}:00 — ${sessions} ${sessionsWord}, ${formatCurrency(cost)}/kWh`
                          : `${dayLabel} ${hourIdx}:00`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-2">
              <Caption>{t('charging.optimizer.cheap', 'Cheap')}</Caption>
              <div className="flex gap-0.5" aria-hidden="true">
                {LEGEND_STOPS.map((o, i) => (
                  <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: heatFill(o, 0.6) }} />
                ))}
              </div>
              <Caption>{t('charging.optimizer.expensive', 'Expensive')}</Caption>
            </div>
          </div>
        </div>
            <Accordion
              title={t('chart.a11y.fallbackTableLabel', '{{title}} — data table', { title })}
              className="mt-4"
            >
              <div
                role="region"
                aria-label={t('chart.a11y.fallbackTableLabel', '{{title}} — data table', { title })}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Allows keyboard users to scroll the data table region.
                tabIndex={0}
                className="max-h-96 min-w-0 max-w-full overflow-auto overscroll-contain p-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <Table
                  variant="embedded"
                  aria-label={chartLabel}
                  tabIndex={0}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <thead>
                    <tr>
                      <th scope="col">{t('charging.heatmap.day', 'Day')}</th>
                      <th scope="col">{t('analytics.charging.hour', 'Hour')}</th>
                      <th scope="col">{t('charging.charts.sessions', 'Sessions')}</th>
                      <th scope="col">{t('charging.grid.costPerEnergy', 'Cost per kWh')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.flatMap((dayLabel, dayIdx) => HOURS.map((hourIdx) => {
                      const entry = cellByKey.get(dayIdx * 24 + hourIdx);
                      const sessions = Math.max(0, safeNumber(entry?.sessions));
                      const cost = Math.max(0, safeNumber(entry?.avg_cost_per_kwh));
                      return (
                        <tr key={`${dayIdx}-${hourIdx}`}>
                          <th scope="row">{dayLabel}</th>
                          <td>{hourIdx}:00</td>
                          <td>{sessions}</td>
                          <td>{sessions > 0 ? `${formatCurrency(cost)}/kWh` : '—'}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </Table>
              </div>
            </Accordion>
            </>
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
