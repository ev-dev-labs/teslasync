import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Battery, Cpu, Activity, TrendingDown, BarChart3, Grid3x3,
  ArrowDownRight, ArrowUpRight, Minus,
} from 'lucide-react';
import clsx from 'clsx';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column, useSortToggle } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { chartMargin, chartMarginLabeled, axisTick } from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ── Types ─────────────────────────────────────────────────────── */

interface CellReading {
  cell_number: number;
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
  imbalance_mv: number;
  pack_voltage: number;
  cells: CellReading[];
  history: HistoryPoint[];
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
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
    bucket: `${(b.low ?? 0).toFixed(3)}–${(b.high ?? 0).toFixed(3)}`,
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
      <span className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => (
          <div
            key={cell.cell_number}
            className={clsx(
              'flex flex-col items-center justify-center rounded-md p-1 text-[9px] font-mono',
              'transition-transform hover:scale-110',
            )}
            style={{ backgroundColor: `${cellColor(cell.voltage, avg)}20`, color: cellColor(cell.voltage, avg) }}
            title={`${t('Cell')} ${cell.cell_number}: ${(cell.voltage ?? 0).toFixed(3)} V (${(cell.delta_from_avg ?? 0) >= 0 ? '+' : ''}${((cell.delta_from_avg ?? 0) * 1000).toFixed(1)} mV)`}
          >
            <span className="font-semibold">{cell.cell_number}</span>
            <span>{(cell.voltage ?? 0).toFixed(3)}</span>
          </div>
        ))}
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

/* ── Page Component ────────────────────────────────────────────── */

export default function BatteryCellsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Battery Cells'));

  const [vehicleId, setVehicleId] = useState<string>('');
  const [showHeatmap, setShowHeatmap] = useState(true);

  /* ── Queries ─── */

  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

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

  /* ── Table ─── */

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('cell_number', 'asc');

  const sortedCells = useMemo(() => {
    if (!data?.cells) return [];
    return sortFn(data.cells, (row, key) => {
      const val = row[key as keyof CellReading];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.cells, sortFn]);

  const columns: Column<CellReading>[] = useMemo(() => [
    {
      key: 'cell_number',
      header: t('Cell #'),
      sortable: true,
      render: (r) => (
        <span className="font-mono font-semibold">{r.cell_number}</span>
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
          <span className={clsx('font-mono', mv > 0 ? 'text-neon-green' : mv < 0 ? 'text-neon-red' : '')}>
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
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* ── Summary Metrics ─── */}
      <FadeIn>
        <div className={clsx('grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6')}>
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
            value={minCell ? `#${minCell.cell_number} ${fmtNumber(minCell.voltage, 4)} V` : '—'}
            icon={<ArrowDownRight className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('Max Cell')}
            value={maxCell ? `#${maxCell.cell_number} ${fmtNumber(maxCell.voltage, 4)} V` : '—'}
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
            <EmptyState
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
                  dataKey="cell_number"
                  tick={axisTick}
                  label={{ value: t('Cell #'), position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                />
                <YAxis
                  tick={axisTick}
                  domain={['dataMin - 0.005', 'dataMax + 0.005']}
                  tickFormatter={(v: number) => v.toFixed(3)}
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
        <div className={clsx('grid gap-4 grid-cols-1 md:grid-cols-2')}>
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
                    type="monotone"
                    dataKey="imbalance_mv"
                    name={t('Imbalance (mV)')}
                    stroke={CHART_COLORS[3]}
                    strokeWidth={2}
                    dot={false}
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
                  tickFormatter={(v: number) => v.toFixed(3)}
                  width={55}
                  label={{ value: t('Voltage (V)'), angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 11 } }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  labelFormatter={(v: string) => formatDateTime(v)}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="min_voltage"
                  name={t('Min Voltage')}
                  stroke={CHART_COLORS[5]}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="4 2"
                />
                <Line
                  type="monotone"
                  dataKey="avg_voltage"
                  name={t('Avg Voltage')}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="max_voltage"
                  name={t('Max Voltage')}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
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
              keyExtractor={(r) => r.cell_number}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
            />
          ) : (
            <EmptyState
              icon={<Battery className="h-8 w-8" />}
              message={t('No cell details available.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
