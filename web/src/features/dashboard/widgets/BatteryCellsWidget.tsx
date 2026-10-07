import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid } from './shared';
import type { StatusCell } from './shared';
import type { WidgetProps } from './types';

/**
 * Derive a status from how far a cell's voltage deviates from the average.
 * ≤5 mV → ok, ≤15 mV → warning, >15 mV → error, missing/invalid → unknown.
 *
 * Exported for unit testing. A `null`, `NaN` or `Infinity` reading resolves
 * to `unknown` rather than masquerading as a critical `error` — a non-finite
 * value is a dropped/garbled reading, not a genuine cell imbalance.
 */
export function cellStatus(voltage: number | null, avg: number): StatusCell['status'] {
  if (voltage == null || !Number.isFinite(voltage)) return 'unknown';
  const deviationMv = Math.abs(voltage - avg) * 1000;
  if (deviationMv <= 5) return 'ok';
  if (deviationMv <= 15) return 'warning';
  return 'error';
}

export default function BatteryCellsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? null;
  const vidStr = vid != null ? String(vid) : null;

  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = useBatteryCells(vidStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const cells = data?.cells ?? [];
  const avgV = data?.avg_voltage ?? 0;

  // Map cells → StatusCell items for the shared grid
  const statusCells = useMemo<StatusCell[]>(() => {
    return cells.map((c) => {
      const status = cellStatus(c.voltage, avgV);
      const label = isWide
        ? `${t('widget.batteryCells.cell', 'Cell')} ${c.cell_id} · M${c.module}`
        : `C${c.cell_id}`;
      const value = isWide
        ? `${fmtNumber(c.voltage, 3)} V / ${fmtNumber(c.temperature, 1)}°`
        : `${fmtNumber(c.voltage, 3)} V`;

      return { id: String(c.cell_id), label, status, value };
    });
  }, [cells, avgV, isWide, t]);

  // Summary stats
  const minV = data?.min_voltage ?? 0;
  const maxV = data?.max_voltage ?? 0;
  const spread = data?.voltage_spread ?? 0;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryCells.title', 'Battery Cells')}
      icon={<Cpu className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        <div className="flex flex-col gap-2 h-full">
          {/* Voltage heatmap grid */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetStatusGrid
              cells={statusCells}
              cols={isWide ? 4 : isCompact ? 2 : 3}
              compact={isCompact}
              emptyMessage={t('widget.batteryCells.noCells', 'No cell data')}
              emptyIcon={<Cpu className="h-5 w-5" />}
            />
          </div>

          {/* Min / Max / Avg / Spread stats */}
          <div className="flex-shrink-0 grid grid-cols-2 gap-2">
            <StatCard
              label={t('widget.batteryCells.minV', 'Min V')}
              value={`${fmtNumber(minV, 3)} V`}
              className="!p-2"
            />
            <StatCard
              label={t('widget.batteryCells.maxV', 'Max V')}
              value={`${fmtNumber(maxV, 3)} V`}
              className="!p-2"
            />
            <StatCard
              label={t('widget.batteryCells.avgV', 'Avg V')}
              value={`${fmtNumber(avgV, 3)} V`}
              className="!p-2"
            />
            <StatCard
              label={t('widget.batteryCells.spread', 'Spread')}
              value={`${fmtNumber(spread * 1000, 1)} mV`}
              className="!p-2"
            />
          </div>

          {/* Wide layout: temperature summary row */}
          {isWide && (
            <div className="flex-shrink-0 grid grid-cols-3 gap-2">
              <StatCard
                label={t('widget.batteryCells.minTemp', 'Min Temp')}
                value={`${fmtNumber(data.min_temperature, 1)}°`}
                className="!p-2"
              />
              <StatCard
                label={t('widget.batteryCells.avgTemp', 'Avg Temp')}
                value={`${fmtNumber(data.avg_temperature, 1)}°`}
                className="!p-2"
              />
              <StatCard
                label={t('widget.batteryCells.maxTemp', 'Max Temp')}
                value={`${fmtNumber(data.max_temperature, 1)}°`}
                className="!p-2"
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Cpu className="h-5 w-5" />}
          message={t('widget.batteryCells.noData', 'No battery cell data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
