import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, Cpu, Activity, TrendingDown, BarChart3, Grid3x3,
  ArrowDownRight, ArrowUpRight, Minus, Thermometer, Zap,
  CheckCircle, AlertTriangle, Shield, Info,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button, DataTable, type Column, useSortToggle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  chartGrid, axisTick, axisTickSm, chartMargin, chartMarginLabeled, CHART_COLORS,
  renderAnnotationLines,
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { useQuery } from '@tanstack/react-query';

/* ── Types ─────────────────────────────────────────────────────── */

interface CellReading {
  cell_id: number;
  voltage: number;
  delta_from_avg: number;
  status: 'normal' | 'low' | 'high' | 'critical';
}

interface HistoryPoint {
  timestamp: string;
  min_voltage: number;
  max_voltage: number;
  avg_voltage: number;
  imbalance_mv: number;
}

interface BatteryCellData {
  total_cells: number;
  avg_voltage: number;
  min_voltage: number;
  max_voltage: number;
  voltage_spread: number;
  imbalance_mv: number;
  pack_voltage: number;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  temp_spread: number;
  cells: CellReading[];
  history: HistoryPoint[];
}

/* ── Helpers ───────────────────────────────────────────────────── */

/** Color a cell by how far it deviates from the pack average (mV). */
function cellColor(voltage: number, avg: number): string {
  const delta = Math.abs(voltage - avg) * 1000;
  if (delta < 5) return '#10b981';  // green – nominal
  if (delta < 15) return '#f59e0b'; // amber – slight deviation
  return '#ef4444';                 // red   – significant deviation
}

function statusVariant(status: CellReading['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'normal':   return 'success';
    case 'low':      return 'warning';
    case 'high':     return 'warning';
    case 'critical': return 'danger';
  }
}

function statusIcon(status: CellReading['status']) {
  switch (status) {
    case 'low':      return <ArrowDownRight className="h-3 w-3" />;
    case 'high':     return <ArrowUpRight className="h-3 w-3" />;
    case 'critical': return <TrendingDown className="h-3 w-3" />;
    default:         return <Minus className="h-3 w-3" />;
  }
}

/** Build a histogram of voltage distribution across buckets. */
function buildHistogram(cells: CellReading[]): { bucket: string; count: number }[] {
  if (cells.length === 0) return [];
  const voltages = cells.map((c) => c.voltage);
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

/* ── Heatmap Grid Component ────────────────────────────────────── */

function CellHeatmap({
  cells,
  avg,
  label,
}: {
  cells: CellReading[];
  avg: number;
  label: string;
}) {
  const { t } = useTranslation();
  const cols = Math.ceil(Math.sqrt(cells.length));

  return (
    <GlassPanel className="p-4">
      <style>{`
        @keyframes cell-fade-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes cell-pulse {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          50% { box-shadow: 0 0 8px currentColor; }
        }
      `}</style>
      <span className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, i) => {
          const deviation = Math.abs(cell.delta_from_avg ?? 0);
          const isDeviation = deviation > 0.005; // > 5mV
          return (
            <div
              key={cell.cell_id}
              className={cn(
                'flex flex-col items-center justify-center rounded-md p-1 text-[9px] font-mono',
                'transition-all hover:scale-110 hover:z-10 hover:shadow-lg',
                'animate-[cell-fade-in_0.4s_ease-out_both]',
                isDeviation && 'animate-[cell-fade-in_0.4s_ease-out_both,cell-pulse_3s_ease-in-out_infinite_0.5s]',
              )}
              style={{
                backgroundColor: `${cellColor(cell.voltage, avg)}20`,
                color: cellColor(cell.voltage, avg),
                animationDelay: `${i * 15}ms`,
              }}
              title={`${t('Cell')} ${cell.cell_id}: ${fmtNumber(cell.voltage ?? 0, 3)} V (${(cell.delta_from_avg ?? 0) >= 0 ? '+' : ''}${fmtNumber((cell.delta_from_avg ?? 0) * 1000, 1)} mV)`}
            >
              <span className="font-semibold">{cell.cell_id}</span>
              <span>{fmtNumber(cell.voltage ?? 0, 3)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          {t('Nominal')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
          {t('Slight Deviation')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          {t('Significant Deviation')}
        </span>
      </div>
    </GlassPanel>
  );
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

/* ── Page Component ────────────────────────────────────────────── */

export default function BatteryCellsPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.cells.title', 'Battery Cells'));

  const [showHeatmap, setShowHeatmap] = useState(true);

  /* ── Queries ─── */

  // Phase 40 / Prompt 16: header picker is the source of truth for vehicle scope.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const { data, isLoading, error } = useQuery<BatteryCellData>({
    queryKey: ['battery-cells', activeId],
    queryFn: () => request<BatteryCellData>(`/analytics/battery-cells?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  /* ── Derived data ─── */

  const histogram = useMemo(() => buildHistogram(data?.cells ?? []), [data?.cells]);

  const minCell = useMemo(() => {
    if (!data?.cells?.length) return null;
    return data.cells.reduce((a, b) => (a.voltage < b.voltage ? a : b));
  }, [data?.cells]);

  const maxCell = useMemo(() => {
    if (!data?.cells?.length) return null;
    return data.cells.reduce((a, b) => (a.voltage > b.voltage ? a : b));
  }, [data?.cells]);

  /* ── Derived: voltage spread trend from history ─── */
  const voltageSpreadTrend = useMemo(() => {
    const hist = data?.history ?? [];
    if (hist.length === 0) return [];
    return hist.map((h) => ({
      time: formatDateTime(h.timestamp).split(',')[0],
      spread: fmtNumber((h.max_voltage - h.min_voltage) * 1000, 1),
      spreadRaw: (h.max_voltage - h.min_voltage) * 1000,
    }));
  }, [data?.history]);

  /* ── Derived: health insights ─── */
  const insights = useMemo(() => {
    if (!data) return [];
    const items: { icon: React.ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[] = [];
    const imb = data.imbalance_mv ?? 0;

    if (imb > 15) {
      items.push({
        icon: <Zap className="h-4 w-4" />,
        title: t('battery.cells.insight.highSpread', 'High Voltage Spread'),
        description: t('battery.cells.insight.highSpreadDesc', 'Cell imbalance is significant. Consider a full charge to 100% to allow BMS balancing, then discharge to 90%.'),
        status: 'critical',
      });
    } else if (imb > 5) {
      items.push({
        icon: <Zap className="h-4 w-4" />,
        title: t('battery.cells.insight.watchSpread', 'Voltage Spread Increasing'),
        description: t('battery.cells.insight.watchSpreadDesc', 'Cell balance is slightly off. Periodic full charges can help the BMS equalize cells.'),
        status: 'warning',
      });
    } else {
      items.push({
        icon: <CheckCircle className="h-4 w-4" />,
        title: t('battery.cells.insight.balanced', 'Cells Well Balanced'),
        description: t('battery.cells.insight.balancedDesc', 'Voltage spread is within healthy range. Battery cells are operating normally.'),
        status: 'good',
      });
    }

    if (data.temp_spread > 5) {
      items.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: t('battery.cells.insight.highTemp', 'High Temperature Spread'),
        description: t('battery.cells.insight.highTempDesc', 'Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging.'),
        status: 'critical',
      });
    } else if (data.temp_spread > 3) {
      items.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: t('battery.cells.insight.watchTemp', 'Module Temperature Variation'),
        description: t('battery.cells.insight.watchTempDesc', 'Some temperature variation is normal. Monitor during fast charging sessions.'),
        status: 'warning',
      });
    } else {
      items.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: t('battery.cells.insight.goodTemp', 'Thermal Balance Good'),
        description: t('battery.cells.insight.goodTempDesc', 'Module temperatures are consistent. Thermal management system is performing well.'),
        status: 'good',
      });
    }

    const criticalCells = data.cells.filter((c) => c.status === 'critical').length;
    if (criticalCells > 0) {
      items.push({
        icon: <AlertTriangle className="h-4 w-4" />,
        title: t('battery.cells.insight.criticalCells', 'Critical Cells Detected'),
        description: t('battery.cells.insight.criticalCellsDesc', { count: criticalCells, defaultValue: '{{count}} cell(s) show significant deviation. Consider scheduling a service appointment.' }),
        status: 'critical',
      });
    } else {
      items.push({
        icon: <Shield className="h-4 w-4" />,
        title: t('battery.cells.insight.healthy', 'All Cells Healthy'),
        description: t('battery.cells.insight.healthyDesc', 'No critical cells detected. Continue current charging habits for long-term health.'),
        status: 'good',
      });
    }

    return items;
  }, [data, t]);

  /* ── Table ─── */

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('cell_id', 'asc');

  const sortedCells = useMemo(() => {
    if (!data?.cells) return [];
    return sortFn(data.cells, (row, key) => {
      const val = row[key as keyof CellReading];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.cells, sortFn]);

  const columns: Column<CellReading>[] = useMemo(() => [
    {
      key: 'cell_id',
      header: t('Cell #'),
      sortable: true,
      render: (r) => (
        <span className="font-mono font-semibold">{r.cell_id}</span>
      ),
    },
    {
      key: 'voltage',
      header: t('Voltage (V)'),
      sortable: true,
      render: (r) => (
        <span className="font-mono" style={{ color: cellColor(r.voltage, data?.avg_voltage ?? 0) }}>
          {fmtNumber(r.voltage, 4)}
        </span>
      ),
    },
    {
      key: 'delta_from_avg',
      header: t('Delta (mV)'),
      sortable: true,
      render: (r) => {
        const mv = r.delta_from_avg * 1000;
        return (
          <span className={cn('font-mono', mv > 0 ? 'text-emerald-300' : mv < 0 ? 'text-rose-300' : '')}>
            {mv >= 0 ? '+' : ''}{fmtNumber(mv, 1)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('Status'),
      sortable: true,
      render: (r) => (
        <Badge variant={statusVariant(r.status)} size="sm" dot>
          {statusIcon(r.status)}
          {t((r.status ?? '').charAt(0).toUpperCase() + (r.status ?? '').slice(1))}
        </Badge>
      ),
    },
  ], [t, data?.avg_voltage]);

  /* ── Render ─── */

  return (
    <PageContainer
      title={t('Battery Cells')}
      subtitle={t('Individual cell voltage monitoring and analysis')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {/* ── Summary Metrics ─── */}
      <FadeIn>
        <div className={cn('grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6')}>
          <MetricCard
            label={t('Total Cells')}
            value={fmtNumber(data?.total_cells ?? 0, 0)}
            icon={<Grid3x3 className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('Avg Voltage')}
            value={`${fmtNumber(data?.avg_voltage ?? 0, 4)} V`}
            icon={<Battery className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('Min Cell')}
            value={minCell ? `#${minCell.cell_id} ${fmtNumber(minCell.voltage, 4)} V` : '—'}
            icon={<ArrowDownRight className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('Max Cell')}
            value={maxCell ? `#${maxCell.cell_id} ${fmtNumber(maxCell.voltage, 4)} V` : '—'}
            icon={<ArrowUpRight className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('Imbalance')}
            value={`${fmtNumber(data?.imbalance_mv ?? 0, 1)} mV`}
            icon={<Activity className="h-4 w-4" />}
            color={(data?.imbalance_mv ?? 0) > 15 ? 'red' : (data?.imbalance_mv ?? 0) > 5 ? 'amber' : 'green'}
          />
          <MetricCard
            label={t('Pack Voltage')}
            value={`${fmtNumber(data?.pack_voltage ?? 0, 1)} V`}
            icon={<Cpu className="h-4 w-4" />}
            color="cyan"
          />
        </div>
      </FadeIn>

      {/* ── Cell Voltage Heatmap ─── */}
      <FadeIn delay={0.05}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {t('Cell Voltage Heatmap')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={showHeatmap ? <BarChart3 className="h-3.5 w-3.5" /> : <Grid3x3 className="h-3.5 w-3.5" />}
            onClick={() => setShowHeatmap((v) => !v)}
          >
            {showHeatmap ? t('Bar View') : t('Grid View')}
          </Button>
        </div>
        {data?.cells && data.cells.length > 0 ? (
          showHeatmap ? (
            <CellHeatmap
              cells={data.cells}
              avg={data.avg_voltage}
              label={t('Cells colored by deviation from average')}
            />
          ) : null
        ) : (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Grid3x3 className="h-8 w-8" />}
              message={t('No cell readings available.')}
            />
          </GlassPanel>
        )}
      </FadeIn>

      {/* ── Cell Voltage Bar Chart ─── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
            {t('Cell Voltage Bar Chart')}
          </span>
          {data?.cells && data.cells.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.cells} margin={chartMarginLabeled}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="cell_id"
                  tick={axisTick}
                  label={{ value: t('Cell #'), position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                />
                <YAxis
                  tick={axisTick}
                  domain={['dataMin - 0.005', 'dataMax + 0.005']}
                  tickFormatter={(v: number) => fmtNumber(v, 3)}
                  width={55}
                  label={{ value: t('Voltage (V)'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine
                  y={data.avg_voltage}
                  stroke={CHART_COLORS[0]}
                  strokeDasharray="4 4"
                  label={{ value: t('Avg'), position: 'right', fill: CHART_COLORS[0], fontSize: 10 }}
                />
                <ReferenceLine
                  y={data.min_voltage}
                  stroke={CHART_COLORS[5]}
                  strokeDasharray="2 2"
                  label={{ value: t('Min'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }}
                />
                <ReferenceLine
                  y={data.max_voltage}
                  stroke={CHART_COLORS[1]}
                  strokeDasharray="2 2"
                  label={{ value: t('Max'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }}
                />
                <Bar
                  dataKey="voltage"
                  name={t('Voltage')}
                  radius={[3, 3, 0, 0]}
                  fill={CHART_COLORS[0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton height={280} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Voltage Distribution & Imbalance Trend ─── */}
      <FadeIn delay={0.15}>
        <div className={cn('grid gap-4 grid-cols-1 md:grid-cols-2')}>
          {/* Voltage Distribution Histogram */}
          <GlassPanel className="p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
              {t('Voltage Distribution')}
            </span>
            {histogram.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={histogram} margin={chartMarginLabeled}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="bucket"
                    tick={axisTick}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={axisTick}
                    allowDecimals={false}
                    label={{ value: t('Cells'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="count"
                    name={t('Cell Count')}
                    fill={CHART_COLORS[2]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={240} />
            )}
          </GlassPanel>

          {/* Imbalance Trend */}
          <GlassPanel className="p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
              {t('Imbalance Trend')}
            </span>
            {data?.history && data.history.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.history} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="timestamp"
                    tick={axisTick}
                    tickFormatter={(v: string) => formatDateTime(v).split(',')[0]}
                  />
                  <YAxis
                    tick={axisTick}
                    unit=" mV"
                    width={55}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    labelFormatter={(v: string) => formatDateTime(v)}
                  />
                  <Legend />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="imbalance_mv"
                    name={t('Imbalance (mV)')}
                    stroke={CHART_COLORS[3]}
                    activeDot={{ r: 4 }}
                  />
                  <ReferenceLine
                    y={5}
                    stroke={CHART_COLORS[1]}
                    strokeDasharray="4 4"
                    label={{ value: t('Nominal'), position: 'right', fill: CHART_COLORS[1], fontSize: 10 }}
                  />
                  <ReferenceLine
                    y={15}
                    stroke={CHART_COLORS[5]}
                    strokeDasharray="4 4"
                    label={{ value: t('Warning'), position: 'right', fill: CHART_COLORS[5], fontSize: 10 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={240} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Cell Voltage Over Time ─── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
            {t('Cell Voltage Over Time')}
          </span>
          {data?.history && data.history.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.history} margin={chartMarginLabeled}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="timestamp"
                  tick={axisTick}
                  tickFormatter={(v: string) => formatDateTime(v).split(',')[0]}
                />
                <YAxis
                  tick={axisTick}
                  domain={['dataMin - 0.002', 'dataMax + 0.002']}
                  tickFormatter={(v: number) => fmtNumber(v, 3)}
                  width={55}
                  label={{ value: t('Voltage (V)'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  labelFormatter={(v: string) => formatDateTime(v)}
                />
                <Legend />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="min_voltage"
                  name={t('Min Voltage')}
                  stroke={CHART_COLORS[5]}
                  strokeDasharray="4 2"
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="avg_voltage"
                  name={t('Avg Voltage')}
                  stroke={CHART_COLORS[0]}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="max_voltage"
                  name={t('Max Voltage')}
                  stroke={CHART_COLORS[1]}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton height={280} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Cell Details Table ─── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {t('Cell Details')}
            </span>
            {data?.cells && (
              <Badge variant="neutral" size="sm">
                {data.cells.length} {t('cells')}
              </Badge>
            )}
          </div>
          {sortedCells.length > 0 ? (
            <DataTable
              columns={columns}
              data={sortedCells}
              keyExtractor={(r) => r.cell_id}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Battery className="h-8 w-8" />}
              message={t('No cell details available.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Voltage Spread Trend ─── */}
      <FadeIn delay={0.3}>
        <ChartContainer
          title={t('battery.cells.chart.spreadTrend', 'Voltage Spread Trend')}
          annotations={{ vehicleId, scope: 'battery', chartId: 'battery-cells-spread-trend' }}
        >
          {({ annotations: chartAnnotations }) =>
            voltageSpreadTrend.length > 0 ? (
              <div className="h-48 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={voltageSpreadTrend}>
                    <defs>
                      <ChartGradient id="spreadGrad" color="#a855f7" opacity={0.3} />
                    </defs>
                    {chartGrid}
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
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.cells.chart.noSpreadTrend', 'Not enough history for spread trend')}
                className="py-8"
              />
            )
          }
        </ChartContainer>
      </FadeIn>

      {/* ── Temperature Summary ─── */}
      <FadeIn delay={0.35}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-neon-amber" />
            {t('battery.cells.temp.title', 'Temperature Summary')}
          </h3>
          {data ? (
            <Grid cols={{ default: 2, md: 4 }} gap={4}>
              <MetricCard
                label={t('battery.cells.temp.avg', 'Avg Temperature')}
                value={`${fmtNumber(data.avg_temperature, 1)}°C`}
                icon={<Thermometer className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('battery.cells.temp.min', 'Min Temperature')}
                value={`${fmtNumber(data.min_temperature, 1)}°C`}
                icon={<ArrowDownRight className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('battery.cells.temp.max', 'Max Temperature')}
                value={`${fmtNumber(data.max_temperature, 1)}°C`}
                icon={<ArrowUpRight className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('battery.cells.temp.spread', 'Temp Spread')}
                value={`${fmtNumber(data.temp_spread, 1)}°C`}
                icon={<Activity className="h-5 w-5" />}
                color={data.temp_spread > 5 ? 'red' : data.temp_spread > 3 ? 'amber' : 'green'}
              />
            </Grid>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Thermometer className="h-8 w-8" />}
              message={t('battery.cells.temp.empty', 'No temperature data available')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Health Recommendations ─── */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-neon-green" />
            {t('battery.cells.recommendations', 'Health Recommendations')}
          </h3>
          {insights.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {insights.map((ins, i) => (
                <GlassPanel
                  key={i}
                  className={cn('border p-4 transition-all duration-normal', insightPanelClass[ins.status])}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('mt-0.5', insightIconClass[ins.status])}>{ins.icon}</div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{ins.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{ins.description}</p>
                    </div>
                  </div>
                </GlassPanel>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Info className="h-8 w-8" />}
              message={t('battery.cells.noInsights', 'Not enough data for recommendations')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Summary Stats ─── */}
      <FadeIn delay={0.45}>
        <Grid cols={{ default: 2, sm: 3, lg: 6 }} gap={3}>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.totalCells', 'Total Cells')}
            </p>
            <p className="text-2xl font-bold text-cyan-300">{data?.total_cells ?? 0}</p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.packVoltage', 'Pack Voltage')}
            </p>
            <p className="text-2xl font-bold text-emerald-300">
              {fmtNumber(data?.pack_voltage ?? 0, 1)}<span className="text-sm">V</span>
            </p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.avgVoltage', 'Avg Cell V')}
            </p>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {fmtNumber(data?.avg_voltage ?? 0, 4)}<span className="text-sm">V</span>
            </p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.voltageSpread', 'V Spread')}
            </p>
            <p className={cn('text-2xl font-bold',
              (data?.imbalance_mv ?? 0) > 15 ? 'text-rose-300' :
              (data?.imbalance_mv ?? 0) > 5 ? 'text-amber-300' : 'text-emerald-300'
            )}>
              {fmtNumber(data?.imbalance_mv ?? 0, 1)}<span className="text-sm">mV</span>
            </p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.tempSpread', 'Temp Spread')}
            </p>
            <p className={cn('text-2xl font-bold',
              (data?.temp_spread ?? 0) > 5 ? 'text-rose-300' :
              (data?.temp_spread ?? 0) > 3 ? 'text-amber-300' : 'text-emerald-300'
            )}>
              {fmtNumber(data?.temp_spread ?? 0, 1)}<span className="text-sm">°C</span>
            </p>
          </GlassPanel>
          <GlassPanel className="p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t('battery.cells.stat.normalCells', 'Normal Cells')}
            </p>
            <p className="text-2xl font-bold text-emerald-300">
              {data?.cells.filter((c) => c.status === 'normal').length ?? 0}
              <span className="text-sm">/{data?.total_cells ?? 0}</span>
            </p>
          </GlassPanel>
        </Grid>
      </FadeIn>
    </PageContainer>
  );
}
