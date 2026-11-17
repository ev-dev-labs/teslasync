import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Clock } from 'lucide-react';
import { Accordion, Caption, GlassPanel, PanelTitle, Table } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { HeatmapLegend } from '@/components/charts';
import { DAYS } from '@/lib/constants';
import { safeNumber } from '@/lib/numberFormat';
import type { ChargingOptimizerData, OptimizerHeatmapEntry } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { heatmapColor, type HeatmapLevel } from '@/lib/heatmap';

interface CostHeatmapProps {
  heatmap: ChargingOptimizerData['weekly_heatmap'];
  peakCostPerKwh: number;
}

/** Hours of the day (0..23) — hoisted so the array identity is stable per render. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Default upper bound for the cost colour scale when no peak rate is known. */
const DEFAULT_MAX_COST = 0.3;

/**
 * Cost intensity remains relative to the configured peak rate. Positive
 * evidence uses opaque levels, never lower contrast for fewer sessions.
 */
export function heatFill(intensity: number, alpha: number): string {
  const t = Math.max(0, Math.min(1, safeNumber(intensity)));
  const a = Math.max(0, Math.min(1, safeNumber(alpha)));
  return heatmapColor(a === 0 ? 0 : Math.min(4, 1 + Math.floor(t * 4)) as HeatmapLevel);
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
      <figure
        data-app-part="chart"
        data-chart-family="heatmap"
        data-chart-variant="embedded"
        data-chart-state={hasData ? 'ready' : 'empty'}
        aria-label={chartLabel}
        className="m-0 min-w-0 max-w-full"
      >
      <PanelTitle data-app-part="chart-header" as="h3" className="mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {title}
      </PanelTitle>
      {hasData ? (
        <>
        <div
          data-app-part="chart-plot"
          data-chart-viewport="native"
          role="region"
          aria-label={chartLabel}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Allows keyboard users to scroll the chart region.
          tabIndex={0}
          className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain p-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <div data-cost-heatmap-grid className="min-w-[600px]">
            <div
              role="img"
              aria-label={chartLabel}
            >
              {/* Hour labels */}
              <div data-cost-heatmap-axis className="flex gap-0.5 ms-12 mb-1">
                {HOURS.map((i) => (
                  <Caption key={i} className="flex-1 text-center">
                    {i % 3 === 0 ? `${i}` : ''}
                  </Caption>
                ))}
              </div>
              {/* Grid rows */}
              {DAYS.map((dayLabel, dayIdx) => (
                <div key={dayLabel} data-cost-heatmap-day className="flex items-center gap-0.5 mb-0.5">
                  <Caption data-cost-heatmap-day-label className="w-10 shrink-0 text-end me-1">{dayLabel}</Caption>
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
            <HeatmapLegend
              label={chartLabel}
              less={t('charging.optimizer.cheap', 'Cheap')}
              more={t('charging.optimizer.expensive', 'Expensive')}
            />
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
                  data-mobile-stack-table
                  aria-label={chartLabel}
                  tabIndex={0}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <thead data-app-part="table-head">
                    <tr data-app-part="table-row">
                      <th data-app-part="table-cell" scope="col">{t('charging.heatmap.day', 'Day')}</th>
                      <th data-app-part="table-cell" scope="col">{t('analytics.charging.hour', 'Hour')}</th>
                      <th data-app-part="table-cell" scope="col">{t('charging.charts.sessions', 'Sessions')}</th>
                      <th data-app-part="table-cell" scope="col">{t('charging.grid.costPerEnergy', 'Cost per kWh')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.flatMap((dayLabel, dayIdx) => HOURS.map((hourIdx) => {
                      const entry = cellByKey.get(dayIdx * 24 + hourIdx);
                      const sessions = Math.max(0, safeNumber(entry?.sessions));
                      const cost = Math.max(0, safeNumber(entry?.avg_cost_per_kwh));
                      return (
                        <tr data-app-part="table-row" key={`${dayIdx}-${hourIdx}`}>
                          <th data-app-part="table-cell" scope="row">{dayLabel}</th>
                          <td data-app-part="table-cell" data-mobile-label={t('analytics.charging.hour', 'Hour')}>{hourIdx}:00</td>
                          <td data-app-part="table-cell" data-mobile-label={t('charging.charts.sessions', 'Sessions')}>{sessions}</td>
                          <td data-app-part="table-cell" data-mobile-label={t('charging.grid.costPerEnergy', 'Cost per kWh')}>{sessions > 0 ? `${formatCurrency(cost)}/kWh` : '—'}</td>
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
      </figure>
    </GlassPanel>
  );
}
