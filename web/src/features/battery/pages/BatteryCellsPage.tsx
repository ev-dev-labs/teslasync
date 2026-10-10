import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, Activity, BarChart3, Grid3x3,
  ArrowUpRight, Minus, Thermometer, Zap,
  CheckCircle, AlertTriangle, Shield, Info,
} from 'lucide-react';

import { PageLayout, CardGrid, LayoutCard, ChartCard } from '@/components/layout';

import {
  GlassPanel, Badge, Button, DataTable, Text, Caption,
  type Column, useSortToggle,
} from '@/components/ui';
import {
  ChartLegend, ChartTooltip, ChartGradient, EmbeddedChart,
  axisTick, axisTickSm, chartMargin, chartMarginLabeled, CHART_COLORS,
  renderAnnotationLines,
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useBatteryCells, type CellReading, type CellStatus } from '@/api/hooks/useAnalytics';
import { formatDateTime } from '@/lib/dateFormat';

import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { fmtScientificNumber } from '@/lib/numberFormat';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { BatteryCellsStats } from '../components/battery-cells-modernization/BatteryCellsStats';

/* ── Helpers ───────────────────────────────────────────────────── */

/** Color a cell by how far it deviates from the pack average (mV). */
export function cellColor(voltage: number, avg: number): string {
  const delta = Math.abs(voltage - avg) * 1000;
  if (delta < 5) return '#10b981';  // emerald – nominal
  if (delta < 15) return '#f59e0b'; // amber – slight deviation
  return '#ef4444';                 // rose  – significant deviation
}

/** Badge variant per backend deviation status. Color is paired with an icon
 *  + text label so status never relies on color alone (a11y). */
const STATUS_VARIANT: Record<CellStatus, 'success' | 'warning' | 'danger'> = {
  normal: 'success',
  slight_deviation: 'warning',
  significant_deviation: 'danger',
};

function statusIcon(status: CellStatus) {
  switch (status) {
    case 'significant_deviation': return <AlertTriangle className="h-3 w-3" aria-hidden="true" />;
    case 'slight_deviation':      return <ArrowUpRight className="h-3 w-3" aria-hidden="true" />;
    default:                      return <Minus className="h-3 w-3" aria-hidden="true" />;
  }
}

/** Build a histogram of voltage distribution across buckets. */
export function buildHistogram(cells: CellReading[]): { bucket: string; count: number }[] {
  if (cells.length === 0) return [];
  const voltages = cells.map((c) => knownNumber(c.voltage)).filter((v): v is number => v != null);
  if (voltages.length === 0) return [];
  const min = Math.min(...voltages);
  const max = Math.max(...voltages);
  const range = max - min;
  const bucketCount = Math.max(6, Math.min(12, Math.ceil(cells.length / 4)));
  const step = range > 0 ? range / bucketCount : 0.001;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    low: min + i * step,
    high: min + (i + 1) * step,
    count: 0,
  }));

  for (const v of voltages) {
    const idx = Math.min(Math.floor((v - min) / step), bucketCount - 1);
    buckets[idx].count += 1;
  }

  return buckets.map((b) => ({
    bucket: `${fmtScientificNumber(b.low, 3)}–${fmtScientificNumber(b.high, 3)}`,
    count: b.count,
  }));
}

const insightPanelClass = {
  good: 'border-neon-green/20 bg-neon-green/5',
  warning: 'border-neon-amber/20 bg-neon-amber/5',
  critical: 'border-neon-red/20 bg-neon-red/5',
} as const;

const insightIconClass = {
  good: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-rose-300',
} as const;

/* ── Cell voltage heatmap ──────────────────────────────────────── */

function HeatLegend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block h-2.5 w-2.5 rounded-full', className)} aria-hidden="true" />
      <Caption>{label}</Caption>
    </span>
  );
}

function CellHeatmap({ cells, avg, label }: { cells: CellReading[]; avg: number | null; label: string }) {
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const cols = Math.max(1, Math.ceil(Math.sqrt(cells.length || 1)));

  return (
    <div>
      <Caption className="mb-3 block">{label}</Caption>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => {
          const voltage = knownNumber(cell.voltage);
          const color = voltage != null && avg != null ? cellColor(voltage, avg) : 'var(--text-muted)';
          const delta = knownNumber(cell.delta_from_avg); // already mV
          const isDeviation = delta != null && Math.abs(delta) > 5;
          return (
            <div
              key={cell.cell_number}
              className={cn(
                'flex flex-col items-center justify-center rounded-md p-1',
                typography.size['2xs'],
                typography.family.mono,
                'transition-transform duration-normal hover:z-10 hover:scale-110',
                isDeviation && 'ring-1 ring-inset ring-current',
              )}
              style={{ backgroundColor: voltage != null && avg != null ? `${color}20` : undefined, color }}
              role="img"
              aria-label={`${t('battery.cells.cell', 'Cell')} ${cell.cell_number}: ${voltage == null ? '—' : fmtScientificNumber(voltage, 3)} V (${delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmtNumber(delta)}`} mV)`}
              title={`${t('battery.cells.cell', 'Cell')} ${cell.cell_number}: ${voltage == null ? '—' : fmtScientificNumber(voltage, 3)} V (${delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmtNumber(delta)}`} mV)`}
            >
              <span className={typography.weight.semibold}>{cell.cell_number}</span>
              <span>{voltage == null ? '—' : fmtScientificNumber(voltage, 3)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
        <HeatLegend className="bg-emerald-500" label={t('battery.cells.legend.nominal', 'Nominal')} />
        <HeatLegend className="bg-amber-500" label={t('battery.cells.legend.slight', 'Slight deviation')} />
        <HeatLegend className="bg-rose-500" label={t('battery.cells.legend.significant', 'Significant deviation')} />
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function BatteryCellsPage() {
  const { fmtNumber, fmtScientificNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('battery.cells.title', 'Battery cells'));

  const [showHeatmap, setShowHeatmap] = useState(true);

  // The header picker is the single source of truth for vehicle scope.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const batteryQuery = useBatteryCells(activeId);
  const batteryState = useDataState(batteryQuery, {
    provenance: 'cached',
    unavailable: batteryQuery.data?.status === 'no_data',
  });
  // no_data applies to brick/cell voltages only. The same envelope can still
  // carry real PackVoltage and ModuleTemp signals; never discard those.
  const data = batteryState.data;
  const isLoading = !batteryState.hasData && batteryState.fatalError == null;
  const isError = batteryState.fatalError != null;
  const error = batteryState.fatalError;
  const { refetch } = batteryQuery;

  const cells = data?.cells ?? [];
  const history = data?.history ?? [];
  const avgVoltage = data?.status === 'no_data' ? null : knownNumber(data?.avg_voltage);
  const measuredCells = useMemo(() => cells.filter(cell => knownNumber(cell.voltage) != null), [cells]);

  /* ── Derived data ─── */

  const histogram = useMemo(() => buildHistogram(cells), [cells, displayPrecision, displayLocale]);

  const minCell = useMemo(
    () => (measuredCells.length ? measuredCells.reduce((a, b) => (a.voltage < b.voltage ? a : b)) : null),
    [measuredCells],
  );
  const maxCell = useMemo(
    () => (measuredCells.length ? measuredCells.reduce((a, b) => (a.voltage > b.voltage ? a : b)) : null),
    [measuredCells],
  );

  const voltageSpreadTrend = useMemo(
    () =>
      history.map((h) => ({
        time: formatDateTime(h.timestamp).split(',')[0],
        spread: knownNumber(h.max_voltage) != null && knownNumber(h.min_voltage) != null
          ? fmtNumber((h.max_voltage - h.min_voltage) * 1000) : '—',
        spreadRaw: knownNumber(h.max_voltage) != null && knownNumber(h.min_voltage) != null
          ? (h.max_voltage - h.min_voltage) * 1000 : null,
      })),
    [history, fmtNumber],
  );

  const insights = useMemo(() => {
    if (!data) return [] as { icon: ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[];
    const items: { icon: ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[] = [];
    const imb = data.status === 'no_data' ? null : knownNumber(data.imbalance_mv);

    if (imb != null && imb > 15) {
      items.push({
        icon: <Zap className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.highSpread', 'High voltage spread'),
        description: t('battery.cells.insight.highSpreadDesc', 'Cell imbalance is significant. Consider a full charge to 100% to allow BMS balancing, then discharge to 90%.'),
        status: 'critical',
      });
    } else if (imb != null && imb > 5) {
      items.push({
        icon: <Zap className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.watchSpread', 'Voltage spread increasing'),
        description: t('battery.cells.insight.watchSpreadDesc', 'Cell balance is slightly off. Periodic full charges can help the BMS equalize cells.'),
        status: 'warning',
      });
    } else if (imb != null) {
      items.push({
        icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.balanced', 'Cells well balanced'),
        description: t('battery.cells.insight.balancedDesc', 'Voltage spread is within healthy range. Battery cells are operating normally.'),
        status: 'good',
      });
    }

    // The endpoint omits temperature signal-presence flags. In its no-brick
    // envelope, keep the reported numbers but do not certify thermal health.
    const tempSpread = data.status === 'no_data' ? null : knownNumber(data.temp_spread);
    if (tempSpread != null && tempSpread > 5) {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.highTemp', 'High temperature spread'),
        description: t('battery.cells.insight.highTempDesc', 'Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging.'),
        status: 'critical',
      });
    } else if (tempSpread != null && tempSpread > 3) {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.watchTemp', 'Module temperature variation'),
        description: t('battery.cells.insight.watchTempDesc', 'Some temperature variation is normal. Monitor during fast charging sessions.'),
        status: 'warning',
      });
    } else if (tempSpread != null) {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.goodTemp', 'Thermal balance good'),
        description: t('battery.cells.insight.goodTempDesc', 'Module temperatures are consistent. Thermal management system is performing well.'),
        status: 'good',
      });
    }

    const criticalCells = cells.filter((c) => c.status === 'significant_deviation').length;
    if (criticalCells > 0) {
      items.push({
        icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.criticalCells', 'Critical cells detected'),
        description: t('battery.cells.insight.criticalCellsDesc', { count: criticalCells, defaultValue: '{{count}} cell(s) show significant deviation. Consider scheduling a service appointment.' }),
        status: 'critical',
      });
    } else if (cells.length > 0 && cells.every(cell => ['normal', 'slight_deviation', 'significant_deviation'].includes(cell.status))) {
      items.push({
        icon: <Shield className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.healthy', 'All cells healthy'),
        description: t('battery.cells.insight.healthyDesc', 'No critical cells detected. Continue current charging habits for long-term health.'),
        status: 'good',
      });
    }

    return items;
  }, [data, cells, t]);

  /* ── Table ─── */

  const statusLabel = useCallback((s: CellStatus) => {
    switch (s) {
      case 'normal':               return t('battery.cells.status.normal', 'Normal');
      case 'slight_deviation':     return t('battery.cells.status.slight', 'Slight deviation');
      case 'significant_deviation':return t('battery.cells.status.significant', 'Significant deviation');
      default:                     return t('battery.cells.status.unknown', 'Unknown');
    }
  }, [t]);

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('cell_number', 'asc');

  const sortedCells = useMemo(() => {
    if (cells.length === 0) return [];
    return sortFn(cells, (row, key) => {
      const val = row[key as keyof CellReading];
      return typeof val === 'number' ? val : String(val);
    });
  }, [cells, sortFn]);

  const columns: Column<CellReading>[] = useMemo(() => [
    {
      key: 'cell_number',
      align: 'right',
      filterValue: (r) => r.cell_number ?? null,
      header: t('battery.cells.table.cell', 'Cell #'),
      sortable: true,
      render: (r) => <span className={cn(typography.family.mono, typography.weight.semibold)}>{r.cell_number}</span>,
    },
    {
      key: 'voltage',
      align: 'right',
      filterValue: (r) => r.voltage ?? null,
      filterValueLabel: (value, r) => value == null ? '—' : fmtScientificNumber(r.voltage, 4),
      header: t('battery.cells.table.voltage', 'Voltage (V)'),
      sortable: true,
      render: (r) => (
        <span className={typography.family.mono} style={{ color: knownNumber(r.voltage) != null && avgVoltage != null ? cellColor(r.voltage, avgVoltage) : undefined }}>
          {knownNumber(r.voltage) == null ? '—' : fmtScientificNumber(r.voltage, 4)}
        </span>
      ),
    },
    {
      key: 'delta_from_avg',
      align: 'right',
      filterValue: (r) => r.delta_from_avg ?? null,
      filterValueLabel: (value, r) => value == null ? '—' : `${(r.delta_from_avg ?? 0) >= 0 ? '+' : ''}${fmtNumber(r.delta_from_avg ?? 0)}`,
      header: t('battery.cells.table.delta', 'Delta (mV)'),
      sortable: true,
      render: (r) => {
        const mv = knownNumber(r.delta_from_avg);
        if (mv == null) return <span className={typography.family.mono}>—</span>;
        return (
          <span className={cn(typography.family.mono, mv > 0 ? 'text-emerald-300' : mv < 0 ? 'text-rose-300' : 'text-[var(--text-muted)]')}>
            {mv >= 0 ? '+' : ''}{fmtNumber(mv)}
          </span>
        );
      },
    },
    {
      key: 'status',
      filterValue: (r) => r.status ?? null,
      filterValueLabel: (_, r) => statusLabel(r.status),
      header: t('battery.cells.table.status', 'Status'),
      sortable: true,
      render: (r) => (
        <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'} size="sm" dot>
          {statusIcon(r.status)}
          {statusLabel(r.status)}
        </Badge>
      ),
    },
  ], [t, avgVoltage, statusLabel, fmtNumber, fmtScientificNumber]);

  /* ── Guards ─── */

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.cells.title', 'Battery cells')} />;
  }

  /* ── Render ─── */

  return (
    <PageLayout
      title={t('battery.cells.title', 'Battery cells')}
      subtitle={t('battery.cells.subtitle', 'Individual cell voltage monitoring and analysis')}
      query={batteryQuery}
      busy={batteryState.isRefreshing}
    >
      <StaleRefreshWarning
        state={batteryState} label={t('battery.cells.title', 'Battery cells')}
        title={batteryState.status === 'unavailable' ? t('battery.cells.heatmap.empty', 'No cell readings available.') : undefined}
        message={batteryState.status === 'unavailable'
          ? t('battery.cells.modernization.noCellSnapshot', 'Cell voltage data is unavailable. Any pack and temperature values reported by the backend remain visible.')
          : undefined}
      />
      {/* 1 — KPI band */}
      <FadeIn>
        <BatteryCellsStats
          variant="overview" data={data} cells={cells} minCell={minCell} maxCell={maxCell}
          loading={isLoading} retained={batteryState.status === 'stale'}
          updatedAt={batteryState.updatedAt}
        />
        {isError && <QueryError error={error} onRetry={refetch} />}
      </FadeIn>

      {/* 2 — Hero bento: heatmap/bar toggle (span 2) + voltage distribution */}
      <FadeIn delay={0.05}>
        <CardGrid label={t('battery.cells.heatmap.title', 'Cell voltage heatmap')} items={[
          { id: 'cell-heatmap', size: 'half', content: (
          <LayoutCard title={t('battery.cells.heatmap.title', 'Cell voltage heatmap')} actions={
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11"
                icon={showHeatmap ? <BarChart3 className="h-3.5 w-3.5" /> : <Grid3x3 className="h-3.5 w-3.5" />}
                onClick={() => setShowHeatmap((v) => !v)}
                aria-pressed={!showHeatmap}
                aria-label={showHeatmap ? t('battery.cells.view.bar', 'Switch to bar view') : t('battery.cells.view.grid', 'Switch to grid view')}
              >
                {showHeatmap ? t('battery.cells.view.barLabel', 'Bar view') : t('battery.cells.view.gridLabel', 'Grid view')}
              </Button>
            }>
            {isLoading ? (
              <Skeleton height={320} />
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : cells.length === 0 ? (
              <EmptyState
                /* no-action: transient — per-cell voltage telemetry populates once the BMS
                   reports it for this vehicle; there is no manual trigger to speed it up. */
                icon={<Grid3x3 className="h-8 w-8" />}
                message={t('battery.cells.heatmap.empty', 'No cell readings available.')}
              />
            ) : showHeatmap ? (
              <CellHeatmap
                cells={cells}
                avg={avgVoltage}
                label={t('battery.cells.heatmap.subtitle', 'Cells colored by deviation from average')}
              />
            ) : (
              <EmbeddedChart
                title={t('battery.cells.heatmap.title', 'Cell voltage heatmap')}
                ariaLabel={t(
                  'battery.cells.barView.aria',
                  'Voltage reading for each battery cell',
                )}
                data={cells.map(({ cell_number, voltage }) => ({ cell_number, voltage }))}
                dataColumns={[
                  { key: 'cell_number', label: t('battery.cells.table.cell', 'Cell #') },
                  { key: 'voltage', label: t('battery.cells.table.voltage', 'Voltage (V)') },
                ]}
                fluid={false}
                mobileHeight={288}
                height={288}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cells} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="cell_number" tick={axisTickSm} interval="preserveStartEnd" />
                    <YAxis
                      tick={axisTickSm}
                      domain={['dataMin - 0.005', 'dataMax + 0.005']}
                      tickFormatter={(v: number) => fmtScientificNumber(v, 3)}
                      width={48}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="voltage" name={t('battery.cells.voltage', 'Voltage')} radius={[2, 2, 0, 0]} fill={CHART_COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </LayoutCard>
          ) },
          { id: 'cell-distribution', size: 'third', content: (
          <LayoutCard title={t('battery.cells.distribution.title', 'Voltage distribution')}>
            {isLoading ? (
              <Skeleton height={240} />
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : histogram.length === 0 ? (
              <EmptyState
                /* no-action: transient — the histogram is derived from the same per-cell
                   readings as the heatmap above; it fills in once cells report. */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('battery.cells.distribution.empty', 'No distribution data available.')}
              />
            ) : (
              <EmbeddedChart
                title={t('battery.cells.distribution.title', 'Voltage distribution')}
                ariaLabel={t(
                  'battery.cells.distribution.aria',
                  'Distribution of battery cells by voltage range',
                )}
                data={histogram}
                dataColumns={[
                  { key: 'bucket', label: t('battery.cells.distribution.range', 'Voltage range') },
                  { key: 'count', label: t('battery.cells.distribution.count', 'Cell count') },
                ]}
                fluid={false}
                mobileHeight={224}
                height={256}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram} margin={chartMarginLabeled}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="bucket" tick={axisTickSm} angle={-35} textAnchor="end" height={60} />
                    <YAxis tick={axisTickSm} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name={t('battery.cells.distribution.count', 'Cell count')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* 3 — Cell voltage bar chart (labeled, with reference lines) */}
      <FadeIn delay={0.1}>
        <LayoutCard title={t('battery.cells.bar.title', 'Cell voltage bar chart')}>
          {isLoading ? (
            <Skeleton height={280} />
          ) : isError ? (
            <QueryError error={error} onRetry={refetch} />
          ) : cells.length === 0 ? (
            <EmptyState
              /* no-action: transient — mirrors the same per-cell voltage telemetry gap as the
                 heatmap section above; nothing to trigger manually. */
              icon={<BarChart3 className="h-8 w-8" />}
              message={t('battery.cells.bar.empty', 'No cell voltages available.')}
            />
          ) : (
            <EmbeddedChart
              title={t('battery.cells.bar.title', 'Cell voltage bar chart')}
              ariaLabel={t(
                'battery.cells.bar.aria',
                'Battery cell voltage readings with pack minimum, average, and maximum references',
              )}
              data={cells.map(({ cell_number, voltage }) => ({ cell_number, voltage }))}
              dataColumns={[
                { key: 'cell_number', label: t('battery.cells.table.cell', 'Cell #') },
                { key: 'voltage', label: t('battery.cells.table.voltage', 'Voltage (V)') },
              ]}
              fluid={false}
              mobileHeight={256}
              height={288}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cells} margin={chartMarginLabeled}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="cell_number"
                    tick={axisTick}
                    interval="preserveStartEnd"
                    label={{ value: t('battery.cells.table.cell', 'Cell #'), position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                  />
                  <YAxis
                    tick={axisTick}
                    domain={['dataMin - 0.005', 'dataMax + 0.005']}
                    tickFormatter={(v: number) => fmtScientificNumber(v, 3)}
                    width={55}
                    label={{ value: t('battery.cells.table.voltage', 'Voltage (V)'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  {avgVoltage != null && <ReferenceLine y={avgVoltage} stroke={CHART_COLORS[0]} strokeDasharray="4 4" label={{ value: t('battery.cells.ref.avg', 'Avg'), position: 'right', fill: CHART_COLORS[0], fontSize: 10 }} />}
                  {knownNumber(data?.min_voltage) != null && <ReferenceLine y={data?.min_voltage} stroke={CHART_COLORS[5]} strokeDasharray="2 2" label={{ value: t('battery.cells.ref.min', 'Min'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }} />}
                  {knownNumber(data?.max_voltage) != null && <ReferenceLine y={data?.max_voltage} stroke={CHART_COLORS[1]} strokeDasharray="2 2" label={{ value: t('battery.cells.ref.max', 'Max'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }} />}
                  <Bar dataKey="voltage" name={t('battery.cells.voltage', 'Voltage')} radius={[3, 3, 0, 0]} fill={CHART_COLORS[0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>
          )}
        </LayoutCard>
      </FadeIn>

      {/* 4 — Time-series bento: voltage over time + imbalance trend */}
      <FadeIn delay={0.15}>
        <CardGrid label={t('battery.cells.overTime.title', 'Cell voltage over time')} items={[
          { id: 'cell-voltage-history', size: 'half', content: (
          <LayoutCard title={t('battery.cells.overTime.title', 'Cell voltage over time')}>
            {isLoading ? (
              <Skeleton height={280} />
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : history.length === 0 ? (
              <EmptyState
                /* no-action: transient — needs multiple historical cell snapshots to plot a
                   trend; accumulates automatically as telemetry arrives, no trigger to speed it up. */
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.cells.overTime.empty', 'Not enough history yet.')}
              />
            ) : (
              <EmbeddedChart
                title={t('battery.cells.overTime.title', 'Cell voltage over time')}
                ariaLabel={t(
                  'battery.cells.overTime.aria',
                  'Minimum, average, and maximum battery cell voltage over time',
                )}
                data={history.map(({ timestamp, min_voltage, avg_voltage, max_voltage }) => ({
                  timestamp,
                  min_voltage,
                  avg_voltage,
                  max_voltage,
                }))}
                dataColumns={[
                  { key: 'timestamp', label: t('battery.cells.time', 'Time') },
                  { key: 'min_voltage', label: t('battery.cells.overTime.min', 'Min voltage') },
                  { key: 'avg_voltage', label: t('battery.cells.overTime.avg', 'Avg voltage') },
                  { key: 'max_voltage', label: t('battery.cells.overTime.max', 'Max voltage') },
                ]}
                chartKey="battery-cells-voltage-history"
                fluid={false}
                mobileHeight={256}
                height={288}
              >
                {({ hiddenSeries }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history} margin={chartMarginLabeled}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="timestamp" tick={axisTick} tickFormatter={(v: string) => formatDateTime(v).split(',')[0]} />
                    <YAxis
                      tick={axisTick}
                      domain={['dataMin - 0.002', 'dataMax + 0.002']}
                      tickFormatter={(v: number) => fmtScientificNumber(v, 3)}
                      width={55}
                    />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                      <ChartLegend />
                      <Line {...AREA_DEFAULTS} dataKey="min_voltage" name={t('battery.cells.overTime.min', 'Min voltage')} stroke={CHART_COLORS[5]} strokeDasharray="4 2" hide={hiddenSeries?.isHidden('min_voltage')} />
                      <Line {...AREA_DEFAULTS} dataKey="avg_voltage" name={t('battery.cells.overTime.avg', 'Avg voltage')} stroke={CHART_COLORS[0]} hide={hiddenSeries?.isHidden('avg_voltage')} />
                      <Line {...AREA_DEFAULTS} dataKey="max_voltage" name={t('battery.cells.overTime.max', 'Max voltage')} stroke={CHART_COLORS[1]} strokeDasharray="4 2" hide={hiddenSeries?.isHidden('max_voltage')} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </EmbeddedChart>
            )}
          </LayoutCard>
          ) },
          { id: 'cell-imbalance-history', size: 'half', content: (
          <LayoutCard title={t('battery.cells.imbalance.title', 'Imbalance trend')}>
            {isLoading ? (
              <Skeleton height={280} />
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : history.length === 0 ? (
              <EmptyState
                /* no-action: transient — shares the same historical-snapshot requirement as the
                   voltage-over-time chart to the left; fills in as more samples arrive. */
                icon={<Zap className="h-8 w-8" />}
                message={t('battery.cells.imbalance.empty', 'Not enough history yet.')}
              />
            ) : (
              <EmbeddedChart
                title={t('battery.cells.imbalance.title', 'Imbalance trend')}
                ariaLabel={t(
                  'battery.cells.imbalance.aria',
                  'Battery cell voltage imbalance over time with nominal and warning thresholds',
                )}
                data={history.map(({ timestamp, imbalance_mv }) => ({ timestamp, imbalance_mv }))}
                dataColumns={[
                  { key: 'timestamp', label: t('battery.cells.time', 'Time') },
                  { key: 'imbalance_mv', label: t('battery.cells.imbalance.series', 'Imbalance (mV)') },
                ]}
                fluid={false}
                mobileHeight={256}
                height={288}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="timestamp" tick={axisTick} tickFormatter={(v: string) => formatDateTime(v).split(',')[0]} />
                    <YAxis tick={axisTick} unit=" mV" width={55} />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                    <Line {...AREA_DEFAULTS} dataKey="imbalance_mv" name={t('battery.cells.imbalance.series', 'Imbalance (mV)')} stroke={CHART_COLORS[3]} activeDot={{ r: 4 }} />
                    <ReferenceLine y={5} stroke={CHART_COLORS[1]} strokeDasharray="4 4" label={{ value: t('battery.cells.legend.nominal', 'Nominal'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }} />
                    <ReferenceLine y={15} stroke={CHART_COLORS[5]} strokeDasharray="4 4" label={{ value: t('battery.cells.ref.warning', 'Warning'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }} />
                  </LineChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* 5 — Voltage spread trend (annotated area chart) */}
      <FadeIn delay={0.2}>
        {/* chart-a11y:no-table dense per-sample voltage trace; SR users get the latest spread via the cell summary above */}
        <ChartCard
          toolbar exportable size="standard"
          title={t('battery.cells.chart.spreadTrend', 'Voltage spread trend')}
          ariaLabel={t('battery.cells.chart.spreadTrend.aria', 'Battery cell voltage spread trend area chart over time')}
          annotations={{ vehicleId, scope: 'battery', chartId: 'battery-cells-spread-trend' }}
          loading={isLoading}
          empty={!isLoading && !isError && voltageSpreadTrend.length === 0}
          emptyMessage={t('battery.cells.chart.noSpreadTrend', 'Not enough history for spread trend')}
          error={error}
          onRetry={() => { void refetch(); }}
        >
          {({ annotations: chartAnnotations, hidden }) =>
            isLoading ? (
              <Skeleton height={200} />
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : voltageSpreadTrend.length > 0 ? (
              <div className="h-48 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={voltageSpreadTrend}>
                    <defs>
                      <ChartGradient id="spreadGrad" color="#a855f7" opacity={0.3} />
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit=" mV" />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={5} stroke={CHART_COLORS[1]} strokeDasharray="4 4" />
                    <ReferenceLine y={15} stroke={CHART_COLORS[5]} strokeDasharray="4 4" />
                    {!hidden && renderAnnotationLines(chartAnnotations, (ts) => ts)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="spreadRaw"
                      name={t('battery.cells.chart.voltageSpread', 'Voltage spread (mV)')}
                      stroke="#a855f7"
                      fill="url(#spreadGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                /* no-action: transient — the spread trend needs its own accumulated history
                   window (independent of the raw voltage-over-time series above); fills in over time. */
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.cells.chart.noSpreadTrend', 'Not enough history for spread trend')}
                className="py-8"
              />
            )
          }
        </ChartCard>
      </FadeIn>

      {/* 6 — Cell details table */}
      <FadeIn delay={0.25}>
        <LayoutCard title={t('battery.cells.details.title', 'Cell details')} actions={
            cells.length > 0 ? (
              <Badge variant="neutral" size="sm">
                {t('battery.cells.details.count', '{{count}} cells', { count: cells.length })}
              </Badge>
            ) : null
          }>
          {isLoading ? (
            <Skeleton height={240} />
          ) : isError ? (
            <QueryError error={error} onRetry={refetch} />
          ) : sortedCells.length === 0 ? (
            <EmptyState
              /* no-action: transient — this table lists the same per-cell readings shown in the
                 heatmap/bar sections above; it populates once the BMS reports cell data. */
              icon={<Battery className="h-8 w-8" />}
              message={t('battery.cells.details.empty', 'No cell details available.')}
            />
          ) : (
            <DataTable
              enableValueFilters
              tableId="battery:cells"
              variant="embedded"
              columns={columns}
              mobileColumns={['cell_number', 'voltage', 'delta_from_avg', 'status']}
              mobilePresentation={{
                variant: 'keyValue',
                roles: { cell_number: 'title', voltage: 'primary', delta_from_avg: 'meta', status: 'badge' },
                displayValue: (row, key) => {
                  switch (key) {
                    case 'cell_number': return `${t('battery.cells.cell', 'Cell')} ${row.cell_number}`;
                    case 'voltage': return knownNumber(row.voltage) == null ? '—' : `${fmtScientificNumber(row.voltage, 4)} V`;
                    case 'delta_from_avg': {
                      const delta = knownNumber(row.delta_from_avg);
                      return delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmtNumber(delta)} mV`;
                    }
                    case 'status': return statusLabel(row.status);
                    default: return null;
                  }
                },
                // DataTable's native detail modal renders ALL columns. Delta
                // also remains visible in the retained 640–767px table branch.
              }}
              data={sortedCells}
              keyExtractor={(r) => r.cell_number}
              rowLabel={(r) => `${t('battery.cells.cell', 'Cell')} ${r.cell_number}`}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
        </LayoutCard>
      </FadeIn>

      {/* 7 — Temperature summary + health recommendations bento */}
      <FadeIn delay={0.3}>
        <CardGrid label={t('battery.cells.recommendations', 'Health recommendations')} items={[
          { id: 'cell-temperature', size: 'half', content: (
          <LayoutCard title={t('battery.cells.temp.title', 'Temperature summary')}>
            <BatteryCellsStats
              variant="temperature" data={data} cells={cells} minCell={minCell} maxCell={maxCell}
              loading={isLoading} retained={batteryState.status === 'stale'}
              updatedAt={batteryState.updatedAt}
            />
            {isError ? <QueryError error={error} onRetry={refetch} /> : !isLoading && !data ? (
              <EmptyState
                /* no-action: transient — waits on the vehicle's next temperature-sensor
                   telemetry packet; no user action shortens that cadence. */
                icon={<Thermometer className="h-8 w-8" />}
                message={t('battery.cells.temp.empty', 'No temperature data available')}
                className="py-8"
              />
            ) : null}
          </LayoutCard>
          ) },
          { id: 'cell-recommendations', size: 'half', content: (
          <LayoutCard title={t('battery.cells.recommendations', 'Health recommendations')}>
            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={72} />)}
              </div>
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : insights.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {insights.map((ins, i) => (
                  <GlassPanel key={i} className={cn('border p-4 transition-all duration-normal', insightPanelClass[ins.status])}>
                    <div className="flex items-start gap-3">
                      <div className={cn('mt-0.5', insightIconClass[ins.status])}>{ins.icon}</div>
                      <div className="min-w-0">
                        <Text as="p" variant="body" className={typography.weight.medium}>{ins.title}</Text>
                        <Text as="p" variant="bodySm" className="mt-0.5">{ins.description}</Text>
                      </div>
                    </div>
                  </GlassPanel>
                ))}
              </div>
            ) : (
              <EmptyState
                /* no-action: transient — recommendations are derived from the accumulated cell
                   history above; there's nothing to trigger until enough samples exist. */
                icon={<Info className="h-8 w-8" />}
                message={t('battery.cells.noInsights', 'Not enough data for recommendations')}
                className="py-8"
              />
            )}
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* 8 — Summary stats band */}
      <FadeIn delay={0.35}>
        <BatteryCellsStats
          variant="summary" data={data} cells={cells} minCell={minCell} maxCell={maxCell}
          loading={isLoading} retained={batteryState.status === 'stale'}
          updatedAt={batteryState.updatedAt}
        />
      </FadeIn>
    </PageLayout>
  );
}
