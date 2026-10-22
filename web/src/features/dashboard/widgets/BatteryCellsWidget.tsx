import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, WidgetStatusGrid } from './shared';
import type { StatGridItem, StatusCell } from './shared';
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

  // After-spec summary row (stats primitive): Min / Max / Spread / Temp.
  // Voltages keep 3-decimal honest precision; the spread is shown in mV with
  // the healthy-threshold note from the target design; temperature collapses
  // to the min–max range converted at the display boundary. A measured zero
  // stays a value; a missing reading stays null so the tile shows '—'.
  const minV = knownNumber(data?.min_voltage);
  const maxV = knownNumber(data?.max_voltage);
  const spreadMvRaw = knownNumber(data?.voltage_spread);
  const spreadMv = spreadMvRaw != null ? spreadMvRaw * 1000 : null;
  const minT = knownNumber(data?.min_temperature);
  const maxT = knownNumber(data?.max_temperature);
  const tempRange =
    minT != null && maxT != null
      ? `${formatTemperature(minT)}–${formatTemperature(maxT)}`
      : minT != null
        ? formatTemperature(minT)
        : maxT != null
          ? formatTemperature(maxT)
          : null;
  const summaryStats: StatGridItem[] = [
    {
      label: t('widget.batteryCells.minV', 'Min V'),
      value: minV != null ? fmtNumber(minV, Math.max(3, getGlobalPrecision())) : null,
      unit: 'V',
    },
    {
      label: t('widget.batteryCells.maxV', 'Max V'),
      value: maxV != null ? fmtNumber(maxV, Math.max(3, getGlobalPrecision())) : null,
      unit: 'V',
    },
    {
      label: t('widget.batteryCells.spread', 'Spread'),
      value: spreadMv != null ? fmtNumber(spreadMv) : null,
      unit: 'mV',
      sublabel: spreadMv != null && spreadMv < 30 ? `${t('widget.status.ok', 'Healthy')} < 30 mV` : undefined,
    },
    {
      label: t('widget.motorTemp', 'Temp'),
      value: tempRange,
    },
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

          {/* Min / Max / Spread / Temp summary (After stats row) */}
          <WidgetStatGrid cols={isCompact ? 2 : 4} stats={summaryStats} />
        </div>
    </WidgetShell>
  );
}
