import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BatteryWarning, Clock, Zap, Activity, Lightbulb, ShieldAlert } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select, DataTable, type Column, useSortToggle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, AREA_DEFAULTS,
  chartMargin, axisTick, CHART_COLORS,
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ── Types ── */

interface VampireDrainEntry {
  id: number;
  vehicle_id: number;
  date: string;
  start_battery: number;
  end_battery: number;
  drain_pct: number;
  drain_rate_pct_hr: number;
  duration_hours: number;
  energy_lost_kwh: number;
  sentry_active: boolean;
}

interface VampireDrainStats {
  avg_drain_rate: number;
  total_energy_lost: number;
  worst_drain_pct: number;
  drain_score: number;
  entries: VampireDrainEntry[];
  daily: { date: string; drain_pct: number; hours_parked: number }[];
}

/* ── Component ── */

export default function VampireDrainPage() {
  const { t } = useTranslation();
  usePageTitle(t('vampire.title', 'Vampire Drain'));

  const [vehicleId, setVehicleId] = useState<string>('');

  const { data: vehicles } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data, isLoading, error } = useQuery<VampireDrainStats>({
    queryKey: ['vampire-drain-stats', activeId],
    queryFn: () => request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('date');

  const sortedEntries = useMemo(() => {
    if (!data?.entries) return [];
    return sortFn(data.entries, (row, key) => {
      const val = row[key as keyof VampireDrainEntry];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.entries, sortFn]);

  const columns: Column<VampireDrainEntry>[] = useMemo(() => [
    { key: 'date', header: t('Date'), sortable: true, render: (r) => formatDateTime(r.date) },
    { key: 'duration_hours', header: t('Duration'), sortable: true, render: (r) => `${fmtNumber(r.duration_hours, 1)}h` },
    { key: 'start_battery', header: t('Start %'), sortable: true, render: (r) => `${fmtNumber(r.start_battery, 0)}%` },
    { key: 'end_battery', header: t('End %'), sortable: true, render: (r) => `${fmtNumber(r.end_battery, 0)}%` },
    { key: 'drain_pct', header: t('Loss %'), sortable: true, render: (r) => (
      <Badge variant={r.drain_pct > 5 ? 'danger' : r.drain_pct > 2 ? 'warning' : 'success'}>
        {fmtNumber(r.drain_pct, 1)}%
      </Badge>
    )},
    { key: 'drain_rate_pct_hr', header: t('Rate %/hr'), sortable: true, render: (r) => fmtNumber(r.drain_rate_pct_hr, 2) },
    { key: 'sentry_active', header: t('Sentry'), sortable: true, render: (r) => (
      <Badge variant={r.sentry_active ? 'warning' : 'neutral'} size="sm">
        {r.sentry_active ? t('On') : t('Off')}
      </Badge>
    )},
  ], [t]);

  const scoreColor = (data?.drain_score ?? 0) >= 80
    ? CHART_COLORS[1] : (data?.drain_score ?? 0) >= 50 ? CHART_COLORS[3] : CHART_COLORS[5];

  const tips = useMemo(() => [
    { icon: <ShieldAlert className="h-4 w-4" />, text: t('Disable Sentry Mode when parked at home to save 1–2 % per day.') },
    { icon: <Clock className="h-4 w-4" />, text: t('Reduce third-party app polling intervals to let the car sleep faster.') },
    { icon: <BatteryWarning className="h-4 w-4" />, text: t('Avoid opening the app frequently — each wake cycle costs battery.') },
    { icon: <Activity className="h-4 w-4" />, text: t('Enable energy-saving mode in vehicle settings for better standby.') },
  ], [t]);

  return (
    <PageContainer
      title={t('Vampire Drain')}
      subtitle={t('Analyze phantom energy loss while your vehicle is parked')}
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
      {/* Summary Metrics */}
      <FadeIn>
        <div className={cn('grid gap-4 grid-cols-2 lg:grid-cols-4')}>
          <MetricCard label={t('Avg Drain Rate')} value={`${fmtNumber(data?.avg_drain_rate, 2)}%/hr`} icon={<Zap className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Total Phantom Loss')} value={`${fmtNumber(data?.total_energy_lost, 1)} kWh`} icon={<BatteryWarning className="h-4 w-4" />} color="red" />
          <MetricCard label={t('Worst Session')} value={`${fmtNumber(data?.worst_drain_pct, 1)}%`} icon={<Activity className="h-4 w-4" />} color="amber" />
          <MetricCard label={t('Drain Score')} value={`${fmtNumber(data?.drain_score, 0)}/100`} icon={<ShieldAlert className="h-4 w-4" />} color="green" />
        </div>
      </FadeIn>

      {/* Gauge + Drain Rate Trend */}
      <FadeIn delay={0.1}>
        <div className={cn('grid gap-4 grid-cols-1 md:grid-cols-3')}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            {data ? (
              <RadialGauge
                value={Math.round(data.drain_score)}
                max={100}
                label={t('Score')}
                unit="/100"
                color={scoreColor}
                size={160}
              />
            ) : (
              <Skeleton width="160px" height={160} rounded />
            )}
          </GlassPanel>

          <GlassPanel className="col-span-1 md:col-span-2 p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('Drain Rate Trend')}</span>
            {data?.entries && data.entries.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.entries} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                  <YAxis tick={axisTick} unit="%/hr" width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line {...AREA_DEFAULTS} dataKey="drain_rate_pct_hr" name={t('Drain Rate')} stroke={CHART_COLORS[2]} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={220} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Daily Drain Bar Chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('Daily Drain While Parked')}</span>
          {data?.daily && data.daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.daily} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                <YAxis yAxisId="left" tick={axisTick} unit="%" width={40} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} unit="h" width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar yAxisId="left" dataKey="drain_pct" name={t('Drain %')} fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="hours_parked" name={t('Parked Hours')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton height={260} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Drain Sessions Table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <div className={cn('mb-3 flex items-center justify-between')}>
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t('Drain Sessions')}</span>
            <Badge variant="neutral">{data?.entries?.length ?? 0} {t('sessions')}</Badge>
          </div>
          <DataTable<VampireDrainEntry>
            columns={columns}
            data={sortedEntries}
            keyExtractor={(r) => r.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            emptyMessage={t('No drain sessions recorded yet.')}
            compact
            pagination
          />
        </GlassPanel>
      </FadeIn>

      {/* Recommendations */}
      <FadeIn delay={0.4}>
        <GlassPanel glow="green" className="p-5">
          <div className={cn('mb-3 flex items-center gap-2')}>
            <Lightbulb className="h-5 w-5 text-neon-green" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{t('Tips to Reduce Vampire Drain')}</span>
          </div>
          <ul className="space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className={cn('flex items-start gap-2 text-sm text-[var(--text-secondary)]')}>
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">{tip.icon}</span>
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
