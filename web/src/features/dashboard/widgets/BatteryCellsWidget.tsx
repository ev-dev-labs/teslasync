import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Caption } from '@/components/ui';
import {
  Bar, BarChart, ChartTooltip, EmbeddedChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, axisTickSm, chartGrid,
} from '@/components/charts';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid } from './shared';
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
  const pack = usePackPresentation();

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

  // Preserve voltage precision and display-only temperature conversion.
  // Measured zero stays a value; missing readings remain null.
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
  const chartData = useMemo(() => cells.map((cell, index) => ({
    cell: statusCells[index].label,
    voltage: knownNumber(cell.voltage),
  })), [cells, statusCells]);
  const voltageLabel = t('dashboardWidgets.battery.batteryCells.voltageChart', 'Cell voltage');
  const emptyMessage = data ? t('widget.batteryCells.noCells', 'No cell data') : t('widget.batteryCells.noData', 'No battery cell data');
  const cellsGrid = (
    <div className="min-w-0">
      <WidgetStatusGrid
        cells={statusCells}
        cols={isWide ? 4 : isCompact ? 2 : 3}
        compact={isCompact}
        emptyMessage={emptyMessage}
        emptyIcon={<Cpu className="h-5 w-5" />}
      />
    </div>
  );
  const stats = <WidgetStatGrid cols={isCompact ? 2 : 4} stats={summaryStats} />;
  const voltageChart = (
    <EmbeddedChart title={voltageLabel} ariaLabel={voltageLabel} height={isCompact ? 160 : 200}
      empty={!chartData.some(cell => cell.voltage != null)} emptyMessage={emptyMessage}
      data={chartData} dataColumns={[
        { key: 'cell', label: t('widget.batteryCells.cell', 'Cell') },
        { key: 'voltage', label: `${voltageLabel} (V)`, format: value => knownNumber(value) == null ? '—' : `${fmtScientificNumber(value, 3)} V` },
      ]}
      caption={<Caption>{t('dashboardWidgets.battery.batteryCells.truncatedScale', 'Truncated voltage scale (V).')}</Caption>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          {chartGrid}
          <XAxis dataKey="cell" tick={axisTickSm} tickLine={false} axisLine={false} />
          <YAxis domain={['dataMin - 0.01', 'dataMax + 0.01']} unit=" V" width={76}
            tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={value => fmtScientificNumber(value, 3)} />
          <Tooltip content={<ChartTooltip valueFormatter={value => knownNumber(value) == null ? '—' : `${fmtScientificNumber(value, 3)} V`} />} />
          {avgV != null && <ReferenceLine y={avgV} ifOverflow="extendDomain" stroke="var(--text-muted)" strokeDasharray="4 4"
            label={{ value: t('dashboardWidgets.battery.batteryCells.averageLine', 'Average {{voltage}} V', { voltage: fmtScientificNumber(avgV, 3) }), position: 'insideTopRight', fill: 'var(--text-secondary)' }} />}
          <Bar dataKey="voltage" name={voltageLabel} unit="V" fill="var(--theme-primary)"
            radius={pack === 'v7' ? 0 : [4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </EmbeddedChart>
  );

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
      <InstrumentPresentation family="bars" compact={isCompact} icon={<Cpu />}
        headline={<WidgetBigNumber value={spreadMv != null ? fmtNumber(spreadMv) : null} unit="mV"
          label={t('dashboardWidgets.battery.batteryCells.voltageSpread', 'Cell-voltage spread')} animated={false} />}
        context={<div className="space-y-1">
          <Caption>{t('dashboardWidgets.battery.batteryCells.reportedCells', 'Source-reported cells: {{count}}', { count: cells.length })}</Caption>
          <Caption>{t('dashboardWidgets.battery.batteryCells.availability', 'Only cells supplied by the source are plotted; availability varies.')}</Caption>
        </div>}
        instrument={voltageChart}
        details={<div className="flex min-w-0 flex-col gap-3">{cellsGrid}{stats}</div>}>
        <div className="flex min-w-0 flex-col gap-3">
          {/* Voltage heatmap grid */}
          {cellsGrid}
          {/* Min / Max / Spread / Temp summary (After stats row) */}
          {stats}
        </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
