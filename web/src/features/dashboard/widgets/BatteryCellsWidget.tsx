import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid, WidgetStatGrid } from './shared';
import type { StatusCell } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

/**
 * Derive a status from how far a cell's voltage deviates from the average.
 * ≤5 mV → ok, ≤15 mV → warning, >15 mV → error, missing/invalid → unknown.
 *
 * Exported for unit testing. A `null`, `NaN` or `Infinity` reading resolves
 * to `unknown` rather than masquerading as a critical `error` — a non-finite
 * value is a dropped/garbled reading, not a genuine cell imbalance.
 */
export function cellStatus(voltage: number | null, avg: number | null): StatusCell['status'] {
  if (voltage == null || avg == null || !Number.isFinite(voltage) || !Number.isFinite(avg)) return 'unknown';
  const deviationMv = Math.abs(voltage - avg) * 1000;
  if (deviationMv <= 5) return 'ok';
  if (deviationMv <= 15) return 'warning';
  return 'error';
}

export default function BatteryCellsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtScientificNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? null;
  const vidStr = vid != null ? String(vid) : null;

  const query = useBatteryCells(vidStr);
  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState(query, { provenance: 'historical' });
  const { formatTemperature } = useUnits();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const cells = data?.cells ?? [];
  const avgV = knownNumber(data?.avg_voltage);
  const reading = (value: number | null | undefined, precision = getGlobalPrecision(), unit: string, scale = 1) => {
    const number = knownNumber(value);
    return number == null ? '—' : `${fmtNumber(number * scale, precision)} ${unit}`;
  };

  // Map cells → StatusCell items for the shared grid
  const statusCells = useMemo<StatusCell[]>(() => {
    return cells.map((c) => {
      const status = cellStatus(c.voltage, avgV);
      const label = isWide
        ? `${t('widget.batteryCells.cell', 'Cell')} ${c.cell_id} · M${c.module}`
        : `C${c.cell_id}`;
      const value = isWide
        ? `${knownNumber(c.voltage) != null ? `${fmtScientificNumber(c.voltage, 3)} V` : '—'} / ${formatTemperature(knownNumber(c.temperature))}`
        : knownNumber(c.voltage) != null ? `${fmtScientificNumber(c.voltage, 3)} V` : '—';

      return { id: String(c.cell_id), label, status, value };
    });
  }, [cells, avgV, isWide, t, formatTemperature, fmtNumber, fmtScientificNumber]);

  // Summary stats
  const voltageStats = [
    { label: t('widget.batteryCells.minV', 'Min V'), value: reading(data?.min_voltage, Math.max(3, getGlobalPrecision()), 'V') },
    { label: t('widget.batteryCells.maxV', 'Max V'), value: reading(data?.max_voltage, Math.max(3, getGlobalPrecision()), 'V') },
    { label: t('widget.batteryCells.avgV', 'Avg V'), value: reading(avgV, Math.max(3, getGlobalPrecision()), 'V') },
    { label: t('widget.batteryCells.spread', 'Spread'), value: reading(data?.voltage_spread, undefined, 'mV', 1000) },
  ];

  return (
    <WidgetShell
      title={t('widget.batteryCells.title', 'Battery cells')}
      icon={<Cpu className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        <div className="flex min-w-0 flex-col gap-3">
          {/* Voltage heatmap grid */}
          <div className="min-w-0">
            <WidgetStatusGrid
              cells={statusCells}
              cols={isWide ? 4 : isCompact ? 2 : 3}
              compact={isCompact}
              emptyMessage={data ? t('widget.batteryCells.noCells', 'No cell data') : t('widget.batteryCells.noData', 'No battery cell data')}
              emptyIcon={<Cpu className="h-5 w-5" />}
            />
          </div>

          {/* Min / Max / Avg / Spread stats */}
          <WidgetStatGrid stats={voltageStats} cols={2} />

          {/* Wide layout: temperature summary row */}
          {isWide && (
            <WidgetStatGrid cols={3} stats={[
              { label: t('widget.batteryCells.minTemp', 'Min temp'), value: formatTemperature(knownNumber(data?.min_temperature)) },
              { label: t('widget.batteryCells.avgTemp', 'Avg temp'), value: formatTemperature(knownNumber(data?.avg_temperature)) },
              { label: t('widget.batteryCells.maxTemp', 'Max temp'), value: formatTemperature(knownNumber(data?.max_temperature)) },
            ]} />
          )}
        </div>
    </WidgetShell>
  );
}
