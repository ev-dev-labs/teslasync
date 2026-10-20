import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import type { StatMetric } from '@/components/data-display';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';

import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid } from './shared';
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
  const voltageMetrics: StatMetric[] = [
    { metricId: 'number', occurrenceId: 'cells-min-voltage', rawValue: data?.min_voltage,
      label: t('widget.batteryCells.minV', 'Min V'),
      description: t('widget.batteryCells.voltageSource', 'Returned cell voltage in volts; no conversion is applied to the source measurement.'),
      display: { formatter: raw => ({ value: fmtNumber(raw, Math.max(3, getGlobalPrecision())), unit: 'V' }) } },
    { metricId: 'number', occurrenceId: 'cells-max-voltage', rawValue: data?.max_voltage,
      label: t('widget.batteryCells.maxV', 'Max V'),
      description: t('widget.batteryCells.voltageSource', 'Returned cell voltage in volts; no conversion is applied to the source measurement.'),
      display: { formatter: raw => ({ value: fmtNumber(raw, Math.max(3, getGlobalPrecision())), unit: 'V' }) } },
    { metricId: 'number', occurrenceId: 'cells-average-voltage', rawValue: data?.avg_voltage,
      label: t('widget.batteryCells.avgV', 'Avg V'),
      description: t('widget.batteryCells.voltageSource', 'Returned cell voltage in volts; no conversion is applied to the source measurement.'),
      display: { formatter: raw => ({ value: fmtNumber(raw, Math.max(3, getGlobalPrecision())), unit: 'V' }) } },
    { metricId: 'number', occurrenceId: 'cells-voltage-spread', rawValue: data?.voltage_spread,
      label: t('widget.batteryCells.spread', 'Spread'),
      description: t('widget.batteryCells.spreadSource', 'Returned voltage spread in volts, displayed in millivolts.'),
      display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'mV' }) } },
  ];
  const temperatureMetrics: StatMetric[] = [
    { metricId: 'temperature', occurrenceId: 'cells-min-temperature', rawValue: data?.min_temperature, label: t('widget.batteryCells.minTemp', 'Min temp') },
    { metricId: 'temperature', occurrenceId: 'cells-average-temperature', rawValue: data?.avg_temperature, label: t('widget.batteryCells.avgTemp', 'Avg temp') },
    { metricId: 'temperature', occurrenceId: 'cells-max-temperature', rawValue: data?.max_temperature, label: t('widget.batteryCells.maxTemp', 'Max temp') },
  ];
  const metrics: StatMetric[] = [
    ...voltageMetrics,
    ...(isWide ? temperatureMetrics.map(metric => ({
      ...metric,
      display: { formatter: (raw: number) => ({ value: formatTemperature(raw), unit: '' }) },
    })) : []),
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
          <DashboardSourceBrief metrics={metrics} state={trust}
            eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
            title={t('widget.batteryCells.summaryTitle', 'Returned cell measurements')}
            description={t('widget.batteryCells.summaryDescription', 'Voltage extremes, average and spread summarize the returned cells; wide layouts also retain the temperature summary.')}
            scope={t('widget.batteryCells.summaryScope', 'Vehicle {{id}} · returned cell snapshot; recording coverage is unknown.', { id: vid ?? '—' })}
            loading={isLoading && !data}
            testId="dashboard-battery-cells-brief" />
        </div>
    </WidgetShell>
  );
}
