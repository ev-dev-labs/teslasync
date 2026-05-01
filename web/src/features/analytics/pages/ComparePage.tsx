import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Car, Calendar, TrendingUp, Zap, Gauge, DollarSign, Leaf, Lightbulb,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select, type SelectOption, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, CHART_COLORS,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, chartMarginLabeled, axisTick, chartAnimation,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ── Types ─────────────────────────────────────────────── */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

interface ComparisonRow {
  metric: string;
  periodA: number;
  periodB: number;
  change: number;
  pctChange: string;
  positive: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function pctChange(a: number, b: number): { value: string; positive: boolean } {
  if (b === 0) return { value: '—', positive: true };
  const pct = ((a - b) / b) * 100;
  return { value: `${pct > 0 ? '+' : ''}${fmtNumber(pct, 1)}%`, positive: pct >= 0 };
}

const PERIOD_DAYS: Record<string, number> = {
  '7': 7, '30': 30, '90': 90, '365': 365, '0': 0,
};

/* ── Component ─────────────────────────────────────────── */

export default function ComparePage() {
  const { t } = useTranslation();
  usePageTitle(t('compare.title', 'Compare Periods'));

  const [vehicleId, setVehicleId] = useState('');
  const [periodA, setPeriodA] = useState('30');
  const [periodB, setPeriodB] = useState('90');

  /* ── Queries ── */

  const { data: vehicles } = useVehicles();

  const activeVehicle = vehicleId || String(vehicles?.[0]?.id ?? '');
  const daysA = PERIOD_DAYS[periodA] ?? 30;
  const daysB = PERIOD_DAYS[periodB] ?? 90;

  const statsA = useQuery({
    queryKey: ['period-stats', activeVehicle, daysA],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysA}`,
      ),
    enabled: !!activeVehicle,
  });

  const statsB = useQuery({
    queryKey: ['period-stats', activeVehicle, daysB],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysB}`,
      ),
    enabled: !!activeVehicle,
  });

  const isLoading = statsA.isLoading || statsB.isLoading;
  const error = statsA.error ?? statsB.error;
  const a = statsA.data;
  const b = statsB.data;

  /* ── Derived data ── */

  const periodOptions: SelectOption[] = useMemo(
    () => [
      { value: '7', label: t('compare.last7', 'Last7') },
      { value: '30', label: t('compare.last30', 'Last30') },
      { value: '90', label: t('compare.last90', 'Last90') },
      { value: '365', label: t('Last Year') },
      { value: '0', label: t('All Time') },
    ],
    [t],
  );

  const vehicleOptions: SelectOption[] = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const metrics = useMemo(() => {
    if (!a || !b) return [];
    return [
      { key: 'distance', label: t('Total Distance'), icon: <Car className="h-4 w-4" />, a: a.total_distance, b: b.total_distance, unit: 'km', color: 'cyan' as const },
      { key: 'drives', label: t('Total Drives'), icon: <TrendingUp className="h-4 w-4" />, a: a.total_drives, b: b.total_drives, unit: '', color: 'green' as const },
      { key: 'energy', label: t('Energy Used'), icon: <Zap className="h-4 w-4" />, a: a.energy_used, b: b.energy_used, unit: 'kWh', color: 'purple' as const },
      { key: 'efficiency', label: t('Avg Efficiency'), icon: <Gauge className="h-4 w-4" />, a: a.avg_efficiency, b: b.avg_efficiency, unit: 'Wh/km', color: 'cyan' as const },
      { key: 'cost', label: t('Total Cost'), icon: <DollarSign className="h-4 w-4" />, a: a.total_cost, b: b.total_cost, unit: '$', color: 'green' as const },
      { key: 'co2', label: t('compare.co2Saved', 'Co2Saved'), icon: <Leaf className="h-4 w-4" />, a: a.co2_saved, b: b.co2_saved, unit: 'kg', color: 'purple' as const },
    ];
  }, [a, b, t]);

  const chartData = useMemo(
    () => metrics.map((m) => ({ name: m.label, A: m.a, B: m.b })),
    [metrics],
  );

  const tableRows: ComparisonRow[] = useMemo(
    () =>
      metrics.map((m) => {
        const delta = m.a - m.b;
        const pct = pctChange(m.a, m.b);
        return {
          metric: m.label,
          periodA: m.a,
          periodB: m.b,
          change: delta,
          pctChange: pct.value,
          positive: pct.positive,
        };
      }),
    [metrics],
  );

  const columns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('Metric'),
        render: (r) => <span className="font-medium">{r.metric}</span>,
      },
      {
        key: 'periodA',
        header: t('Period A'),
        sortable: true,
        render: (r) => fmtNumber(r.periodA),
      },
      {
        key: 'periodB',
        header: t('Period B'),
        sortable: true,
        render: (r) => fmtNumber(r.periodB),
      },
      {
        key: 'change',
        header: t('Change'),
        sortable: true,
        render: (r) => (
          <span className={cn(r.positive ? 'text-emerald-300' : 'text-rose-300')}>
            {r.positive ? '↑' : '↓'} {fmtNumber(Math.abs(r.change))}
          </span>
        ),
      },
      {
        key: 'pctChange',
        header: t('Pct Change'),
        render: (r) => (
          <Badge variant={r.positive ? 'success' : 'danger'} size="sm">
            {r.pctChange}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const insights = useMemo(() => {
    if (!a || !b) return [];
    const distPct = pctChange(a.total_distance, b.total_distance);
    const effPct = pctChange(a.avg_efficiency, b.avg_efficiency);
    const costPct = pctChange(a.total_cost, b.total_cost);
    return [
      t('compare.insightDistance', {
        pct: distPct.value,
        dir: distPct.positive ? t('More') : t('Less'),
      }),
      t('compare.insightEfficiency', {
        pct: effPct.value,
        dir: effPct.positive ? t('Improved') : t('Declined'),
      }),
      t('compare.insightCost', {
        pct: costPct.value,
        dir: costPct.positive ? t('Higher') : t('Lower'),
      }),
    ];
  }, [a, b, t]);

  /* ── Render ── */

  return (
    <PageContainer
      title={t('compare.title', 'Compare Periods')}
      subtitle={t('compare.subtitle', 'Compare driving stats across time periods')}
      loading={isLoading}
      error={error as Error | null}
    >
      {/* Selectors */}
      <FadeIn>
        <GlassPanel className="mb-6 flex flex-wrap items-end gap-4 p-4">
          <Select
            label={t('Vehicle')}
            options={vehicleOptions}
            value={activeVehicle}
            onChange={(e) => setVehicleId(e.target.value)}
            className="w-48"
          />
          <Select
            label={t('Period A')}
            options={periodOptions}
            value={periodA}
            onChange={(e) => setPeriodA(e.target.value)}
            className="w-44"
          />
          <Select
            label={t('Period B')}
            options={periodOptions}
            value={periodB}
            onChange={(e) => setPeriodB(e.target.value)}
            className="w-44"
          />
        </GlassPanel>
      </FadeIn>

      {!a || !b ? (
        isLoading ? (
          <Skeleton lines={6} />
        ) : (
          <EmptyState
            icon={<Calendar className="h-10 w-10" />}
            message={t('Empty')}
          />
        )
      ) : (
        <>
          {/* Metric cards */}
          <FadeIn delay={0.05}>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((m) => {
                const pct = pctChange(m.a, m.b);
                return (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={`${fmtNumber(m.a)} ${m.unit}`}
                    icon={m.icon}
                    color={m.color}
                    subtitle={`${t('Period B')}: ${fmtNumber(m.b)} ${m.unit}`}
                    change={pct}
                  />
                );
              })}
            </div>
          </FadeIn>

          {/* Bar chart */}
          <FadeIn delay={0.1}>
            <GlassPanel className="mb-6 p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t('Chart Title')}
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={chartMarginLabeled}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis dataKey="name" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]} label={label as string} />} />
                  <Legend />
                  <Bar
                    dataKey="A"
                    name={t('Period A')}
                    fill={CHART_COLORS[0]}
                    radius={[4, 4, 0, 0]}
                    {...chartAnimation}
                  />
                  <Bar
                    dataKey="B"
                    name={t('Period B')}
                    fill={CHART_COLORS[1]}
                    radius={[4, 4, 0, 0]}
                    {...chartAnimation}
                  />
                </BarChart>
              </ResponsiveContainer>
            </GlassPanel>
          </FadeIn>

          {/* Data table */}
          <FadeIn delay={0.15}>
            <GlassPanel className="mb-6 p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t('Table Title')}
              </p>
              <DataTable
                columns={columns}
                data={tableRows}
                keyExtractor={(r) => r.metric}
                compact
                pagination
              />
            </GlassPanel>
          </FadeIn>

          {/* Insights */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-neon-amber" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {t('Insights')}
                </p>
              </div>
              <ul className="space-y-1.5">
                {insights.map((line, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    • {line}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
