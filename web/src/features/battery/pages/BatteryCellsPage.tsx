import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, Cpu, Activity, BarChart3, Grid3x3,
  ArrowDownRight, ArrowUpRight, Minus, Thermometer, Zap,
  CheckCircle, AlertTriangle, Shield, Info,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel, Badge, Button, DataTable, PanelTitle, Text, Caption, Label,
  type Column, useSortToggle,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  axisTick, axisTickSm, chartMargin, chartMarginLabeled, CHART_COLORS,
  renderAnnotationLines,
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useBatteryCells, type CellReading, type CellStatus } from '@/api/hooks/useAnalytics';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

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
  const voltages = cells.map((c) => c.voltage ?? 0);
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
    bucket: `${fmtNumber(b.low ?? 0, 3)}–${fmtNumber(b.high ?? 0, 3)}`,
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

function CellHeatmap({ cells, avg, label }: { cells: CellReading[]; avg: number; label: string }) {
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
          const color = cellColor(cell.voltage ?? 0, avg);
          const deviation = Math.abs(cell.delta_from_avg ?? 0); // already mV
          const isDeviation = deviation > 5;
          const delta = cell.delta_from_avg ?? 0;
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
              style={{ backgroundColor: `${color}20`, color }}
              title={`${t('battery.cells.cell', 'Cell')} ${cell.cell_number}: ${fmtNumber(cell.voltage ?? 0, 3)} V (${delta >= 0 ? '+' : ''}${fmtNumber(delta, 1)} mV)`}
            >
              <span className={typography.weight.semibold}>{cell.cell_number}</span>
              <span>{fmtNumber(cell.voltage ?? 0, 3)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
        <HeatLegend className="bg-emerald-500" label={t('battery.cells.legend.nominal', 'Nominal')} />
        <HeatLegend className="bg-amber-500" label={t('battery.cells.legend.slight', 'Slight Deviation')} />
        <HeatLegend className="bg-rose-500" label={t('battery.cells.legend.significant', 'Significant Deviation')} />
      </div>
    </div>
  );
}

/* ── Summary stat tile ─────────────────────────────────────────── */

function SummaryStat({ label, value, valueClassName }: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <GlassPanel className="p-4 text-center">
      <Label className="block">{label}</Label>
      <Text as="p" size="2xl" weight="bold" className={cn('mt-1 tabular-nums', valueClassName ?? typography.color.primary)}>
        {value}
      </Text>
    </GlassPanel>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function BatteryCellsPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.cells.title', 'Battery Cells'));

  const { formatTemperature, unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;

  const [showHeatmap, setShowHeatmap] = useState(true);

  // The header picker is the single source of truth for vehicle scope.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const batteryQuery = useBatteryCells(activeId);
  const { data, isLoading, isError, error, refetch } = batteryQuery;

  const cells = data?.cells ?? [];
  const history = data?.history ?? [];
  const avgVoltage = data?.avg_voltage ?? 0;

  /* ── Derived data ─── */

  const histogram = useMemo(() => buildHistogram(cells), [cells]);

  const minCell = useMemo(
    () => (cells.length ? cells.reduce((a, b) => ((a.voltage ?? 0) < (b.voltage ?? 0) ? a : b)) : null),
    [cells],
  );
  const maxCell = useMemo(
    () => (cells.length ? cells.reduce((a, b) => ((a.voltage ?? 0) > (b.voltage ?? 0) ? a : b)) : null),
    [cells],
  );

  const voltageSpreadTrend = useMemo(
    () =>
      history.map((h) => ({
        time: formatDateTime(h.timestamp).split(',')[0],
        spread: fmtNumber(((h.max_voltage ?? 0) - (h.min_voltage ?? 0)) * 1000, 1),
        spreadRaw: ((h.max_voltage ?? 0) - (h.min_voltage ?? 0)) * 1000,
      })),
    [history],
  );

  const insights = useMemo(() => {
    if (!data) return [] as { icon: ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[];
    const items: { icon: ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[] = [];
    const imb = data.imbalance_mv ?? 0;

    if (imb > 15) {
      items.push({
        icon: <Zap className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.highSpread', 'High Voltage Spread'),
        description: t('battery.cells.insight.highSpreadDesc', 'Cell imbalance is significant. Consider a full charge to 100% to allow BMS balancing, then discharge to 90%.'),
        status: 'critical',
      });
    } else if (imb > 5) {
      items.push({
        icon: <Zap className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.watchSpread', 'Voltage Spread Increasing'),
        description: t('battery.cells.insight.watchSpreadDesc', 'Cell balance is slightly off. Periodic full charges can help the BMS equalize cells.'),
        status: 'warning',
      });
    } else {
      items.push({
        icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.balanced', 'Cells Well Balanced'),
        description: t('battery.cells.insight.balancedDesc', 'Voltage spread is within healthy range. Battery cells are operating normally.'),
        status: 'good',
      });
    }

    const tempSpread = data.temp_spread ?? 0;
    if (tempSpread > 5) {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.highTemp', 'High Temperature Spread'),
        description: t('battery.cells.insight.highTempDesc', 'Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging.'),
        status: 'critical',
      });
    } else if (tempSpread > 3) {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.watchTemp', 'Module Temperature Variation'),
        description: t('battery.cells.insight.watchTempDesc', 'Some temperature variation is normal. Monitor during fast charging sessions.'),
        status: 'warning',
      });
    } else {
      items.push({
        icon: <Thermometer className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.goodTemp', 'Thermal Balance Good'),
        description: t('battery.cells.insight.goodTempDesc', 'Module temperatures are consistent. Thermal management system is performing well.'),
        status: 'good',
      });
    }

    const criticalCells = cells.filter((c) => c.status === 'significant_deviation').length;
    if (criticalCells > 0) {
      items.push({
        icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.criticalCells', 'Critical Cells Detected'),
        description: t('battery.cells.insight.criticalCellsDesc', { count: criticalCells, defaultValue: '{{count}} cell(s) show significant deviation. Consider scheduling a service appointment.' }),
        status: 'critical',
      });
    } else {
      items.push({
        icon: <Shield className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.cells.insight.healthy', 'All Cells Healthy'),
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
      case 'slight_deviation':     return t('battery.cells.status.slight', 'Slight Deviation');
      case 'significant_deviation':return t('battery.cells.status.significant', 'Significant Deviation');
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
      header: t('battery.cells.table.cell', 'Cell #'),
      sortable: true,
      render: (r) => <span className={cn(typography.family.mono, typography.weight.semibold)}>{r.cell_number}</span>,
    },
    {
      key: 'voltage',
      header: t('battery.cells.table.voltage', 'Voltage (V)'),
      sortable: true,
      render: (r) => (
        <span className={typography.family.mono} style={{ color: cellColor(r.voltage ?? 0, avgVoltage) }}>
          {fmtNumber(r.voltage ?? 0, 4)}
        </span>
      ),
    },
    {
      key: 'delta_from_avg',
      header: t('battery.cells.table.delta', 'Delta (mV)'),
      sortable: true,
      render: (r) => {
        const mv = r.delta_from_avg ?? 0;
        return (
          <span className={cn(typography.family.mono, mv > 0 ? 'text-emerald-300' : mv < 0 ? 'text-rose-300' : 'text-[var(--text-muted)]')}>
            {mv >= 0 ? '+' : ''}{fmtNumber(mv, 1)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('battery.cells.table.status', 'Status'),
      sortable: true,
      render: (r) => (
        <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'} size="sm" dot>
          {statusIcon(r.status)}
          {statusLabel(r.status)}
        </Badge>
      ),
    },
  ], [t, avgVoltage, statusLabel]);

  /* ── Guards ─── */

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.cells.title', 'Battery Cells')} />;
  }

  /* ── Render ─── */

  return (
    <PageContainer
      title={t('battery.cells.title', 'Battery Cells')}
      subtitle={t('battery.cells.subtitle', 'Individual cell voltage monitoring and analysis')}
      actions={<VehicleSelect />}
      query={batteryQuery}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('battery.cells.kpis', 'Summary metrics')} className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={72} />)
          ) : (
            <>
              <MetricCard
                label={t('battery.cells.kpi.totalCells', 'Total Cells')}
                value={fmtNumber(data?.total_cells ?? 0, 0)}
                icon={<Grid3x3 className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('battery.cells.kpi.avgVoltage', 'Avg Voltage')}
                value={`${fmtNumber(avgVoltage, 4)} V`}
                icon={<Battery className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('battery.cells.kpi.minCell', 'Min Cell')}
                value={minCell ? `#${minCell.cell_number} ${fmtNumber(minCell.voltage ?? 0, 4)} V` : '—'}
                icon={<ArrowDownRight className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('battery.cells.kpi.maxCell', 'Max Cell')}
                value={maxCell ? `#${maxCell.cell_number} ${fmtNumber(maxCell.voltage ?? 0, 4)} V` : '—'}
                icon={<ArrowUpRight className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('battery.cells.kpi.imbalance', 'Imbalance')}
                value={`${fmtNumber(data?.imbalance_mv ?? 0, 1)} mV`}
                icon={<Activity className="h-4 w-4" />}
                color={(data?.imbalance_mv ?? 0) > 15 ? 'red' : (data?.imbalance_mv ?? 0) > 5 ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('battery.cells.kpi.packVoltage', 'Pack Voltage')}
                value={`${fmtNumber(data?.pack_voltage ?? 0, 1)} V`}
                icon={<Cpu className="h-4 w-4" />}
                color="cyan"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: heatmap/bar toggle (span 2) + voltage distribution */}
      <FadeIn delay={0.05}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <PanelTitle className="flex items-center gap-2">
                <Grid3x3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.cells.heatmap.title', 'Cell Voltage Heatmap')}
              </PanelTitle>
              <Button
                variant="ghost"
                size="sm"
                icon={showHeatmap ? <BarChart3 className="h-3.5 w-3.5" /> : <Grid3x3 className="h-3.5 w-3.5" />}
                onClick={() => setShowHeatmap((v) => !v)}
                aria-label={showHeatmap ? t('battery.cells.view.bar', 'Switch to bar view') : t('battery.cells.view.grid', 'Switch to grid view')}
              >
                {showHeatmap ? t('battery.cells.view.barLabel', 'Bar View') : t('battery.cells.view.gridLabel', 'Grid View')}
              </Button>
            </div>
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
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cells} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="cell_number" tick={axisTickSm} interval="preserveStartEnd" />
                    <YAxis
                      tick={axisTickSm}
                      domain={['dataMin - 0.005', 'dataMax + 0.005']}
                      tickFormatter={(v: number) => fmtNumber(v, 3)}
                      width={48}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="voltage" name={t('battery.cells.voltage', 'Voltage')} radius={[2, 2, 0, 0]} fill={CHART_COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('battery.cells.distribution.title', 'Voltage Distribution')}
            </PanelTitle>
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
              <div className="h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram} margin={chartMarginLabeled}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="bucket" tick={axisTickSm} angle={-35} textAnchor="end" height={60} />
                    <YAxis tick={axisTickSm} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name={t('battery.cells.distribution.count', 'Cell Count')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Cell voltage bar chart (labeled, with reference lines) */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('battery.cells.bar.title', 'Cell Voltage Bar Chart')}
          </PanelTitle>
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
            <div className="h-64 sm:h-72">
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
                    tickFormatter={(v: number) => fmtNumber(v, 3)}
                    width={55}
                    label={{ value: t('battery.cells.table.voltage', 'Voltage (V)'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={avgVoltage} stroke={CHART_COLORS[0]} strokeDasharray="4 4" label={{ value: t('battery.cells.ref.avg', 'Avg'), position: 'right', fill: CHART_COLORS[0], fontSize: 10 }} />
                  <ReferenceLine y={data?.min_voltage ?? 0} stroke={CHART_COLORS[5]} strokeDasharray="2 2" label={{ value: t('battery.cells.ref.min', 'Min'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }} />
                  <ReferenceLine y={data?.max_voltage ?? 0} stroke={CHART_COLORS[1]} strokeDasharray="2 2" label={{ value: t('battery.cells.ref.max', 'Max'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }} />
                  <Bar dataKey="voltage" name={t('battery.cells.voltage', 'Voltage')} radius={[3, 3, 0, 0]} fill={CHART_COLORS[0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 4 — Time-series bento: voltage over time + imbalance trend */}
      <FadeIn delay={0.15}>
        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('battery.cells.overTime.title', 'Cell Voltage Over Time')}
            </PanelTitle>
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
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={chartMarginLabeled}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="timestamp" tick={axisTick} tickFormatter={(v: string) => formatDateTime(v).split(',')[0]} />
                    <YAxis
                      tick={axisTick}
                      domain={['dataMin - 0.002', 'dataMax + 0.002']}
                      tickFormatter={(v: number) => fmtNumber(v, 3)}
                      width={55}
                    />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                    <Legend />
                    <Line {...AREA_DEFAULTS} dataKey="min_voltage" name={t('battery.cells.overTime.min', 'Min Voltage')} stroke={CHART_COLORS[5]} strokeDasharray="4 2" />
                    <Line {...AREA_DEFAULTS} dataKey="avg_voltage" name={t('battery.cells.overTime.avg', 'Avg Voltage')} stroke={CHART_COLORS[0]} />
                    <Line {...AREA_DEFAULTS} dataKey="max_voltage" name={t('battery.cells.overTime.max', 'Max Voltage')} stroke={CHART_COLORS[1]} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('battery.cells.imbalance.title', 'Imbalance Trend')}
            </PanelTitle>
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
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="timestamp" tick={axisTick} tickFormatter={(v: string) => formatDateTime(v).split(',')[0]} />
                    <YAxis tick={axisTick} unit=" mV" width={55} />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v: string) => formatDateTime(v)} />
                    <Legend />
                    <Line {...AREA_DEFAULTS} dataKey="imbalance_mv" name={t('battery.cells.imbalance.series', 'Imbalance (mV)')} stroke={CHART_COLORS[3]} activeDot={{ r: 4 }} />
                    <ReferenceLine y={5} stroke={CHART_COLORS[1]} strokeDasharray="4 4" label={{ value: t('battery.cells.legend.nominal', 'Nominal'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }} />
                    <ReferenceLine y={15} stroke={CHART_COLORS[5]} strokeDasharray="4 4" label={{ value: t('battery.cells.ref.warning', 'Warning'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 5 — Voltage spread trend (annotated area chart) */}
      <FadeIn delay={0.2}>
        {/* chart-a11y:no-table dense per-sample voltage trace; SR users get the latest spread via the cell summary above */}
        <ChartContainer
          title={t('battery.cells.chart.spreadTrend', 'Voltage Spread Trend')}
          ariaLabel={t('battery.cells.chart.spreadTrend.aria', 'Battery cell voltage spread trend area chart over time')}
          annotations={{ vehicleId, scope: 'battery', chartId: 'battery-cells-spread-trend' }}
        >
          {({ annotations: chartAnnotations }) =>
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
                    {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="spreadRaw"
                      name={t('battery.cells.chart.voltageSpread', 'Voltage Spread (mV)')}
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
        </ChartContainer>
      </FadeIn>

      {/* 6 — Cell details table */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <PanelTitle className="flex items-center gap-2">
              <Battery className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('battery.cells.details.title', 'Cell Details')}
            </PanelTitle>
            {cells.length > 0 && (
              <Badge variant="neutral" size="sm">
                {t('battery.cells.details.count', '{{count}} cells', { count: cells.length })}
              </Badge>
            )}
          </div>
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
              tableId="battery:cells"
              columns={columns}
              data={sortedCells}
              keyExtractor={(r) => r.cell_number}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* 7 — Temperature summary + health recommendations bento */}
      <FadeIn delay={0.3}>
        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('battery.cells.temp.title', 'Temperature Summary')}
            </PanelTitle>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={72} />)}
              </div>
            ) : isError ? (
              <QueryError error={error} onRetry={refetch} />
            ) : data ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <MetricCard
                  label={t('battery.cells.temp.avg', 'Avg Temperature')}
                  value={formatTemperature(data.avg_temperature, { precision: 1 })}
                  icon={<Thermometer className="h-5 w-5" />}
                  color="green"
                />
                <MetricCard
                  label={t('battery.cells.temp.min', 'Min Temperature')}
                  value={formatTemperature(data.min_temperature, { precision: 1 })}
                  icon={<ArrowDownRight className="h-5 w-5" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('battery.cells.temp.max', 'Max Temperature')}
                  value={formatTemperature(data.max_temperature, { precision: 1 })}
                  icon={<ArrowUpRight className="h-5 w-5" />}
                  color="amber"
                />
                <MetricCard
                  label={t('battery.cells.temp.spread', 'Temp Spread')}
                  value={`${fmtNumber(tempUnit === '°F' ? (data.temp_spread ?? 0) * 1.8 : (data.temp_spread ?? 0), 1)}${tempUnit}`}
                  icon={<Activity className="h-5 w-5" />}
                  color={(data.temp_spread ?? 0) > 5 ? 'red' : (data.temp_spread ?? 0) > 3 ? 'amber' : 'green'}
                />
              </div>
            ) : (
              <EmptyState
                /* no-action: transient — waits on the vehicle's next temperature-sensor
                   telemetry packet; no user action shortens that cadence. */
                icon={<Thermometer className="h-8 w-8" />}
                message={t('battery.cells.temp.empty', 'No temperature data available')}
                className="py-8"
              />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('battery.cells.recommendations', 'Health Recommendations')}
            </PanelTitle>
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
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 8 — Summary stats band */}
      <FadeIn delay={0.35}>
        <section aria-label={t('battery.cells.summary', 'At a glance')} className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryStat
            label={t('battery.cells.stat.totalCells', 'Total Cells')}
            value={data?.total_cells ?? 0}
            valueClassName="text-cyan-300"
          />
          <SummaryStat
            label={t('battery.cells.stat.packVoltage', 'Pack Voltage')}
            value={<>{fmtNumber(data?.pack_voltage ?? 0, 1)}<span className={typography.size.sm}>V</span></>}
            valueClassName="text-emerald-300"
          />
          <SummaryStat
            label={t('battery.cells.stat.avgVoltage', 'Avg Cell V')}
            value={<>{fmtNumber(avgVoltage, 4)}<span className={typography.size.sm}>V</span></>}
          />
          <SummaryStat
            label={t('battery.cells.stat.voltageSpread', 'V Spread')}
            value={<>{fmtNumber(data?.imbalance_mv ?? 0, 1)}<span className={typography.size.sm}>mV</span></>}
            valueClassName={(data?.imbalance_mv ?? 0) > 15 ? 'text-rose-300' : (data?.imbalance_mv ?? 0) > 5 ? 'text-amber-300' : 'text-emerald-300'}
          />
          <SummaryStat
            label={t('battery.cells.stat.tempSpread', 'Temp Spread')}
            value={<>{fmtNumber(tempUnit === '°F' ? (data?.temp_spread ?? 0) * 1.8 : (data?.temp_spread ?? 0), 1)}<span className={typography.size.sm}>{tempUnit}</span></>}
            valueClassName={(data?.temp_spread ?? 0) > 5 ? 'text-rose-300' : (data?.temp_spread ?? 0) > 3 ? 'text-amber-300' : 'text-emerald-300'}
          />
          <SummaryStat
            label={t('battery.cells.stat.normalCells', 'Normal Cells')}
            value={<>{cells.filter((c) => c.status === 'normal').length}<span className={typography.size.sm}>/{data?.total_cells ?? 0}</span></>}
            valueClassName="text-emerald-300"
          />
        </section>
      </FadeIn>
    </PageContainer>
  );
}
