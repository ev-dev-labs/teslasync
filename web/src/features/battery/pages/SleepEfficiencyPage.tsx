import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Moon, BatteryWarning, Clock, Activity, Lightbulb, Zap } from 'lucide-react';
import clsx from 'clsx';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column, useSortToggle } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { chartMargin, axisTick } from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ── Types ── */

interface SleepSession {
  id: number;
  vehicle_id: number;
  start_date: string;
  end_date: string;
  duration_hours: number;
  start_battery: number;
  end_battery: number;
  drain_pct: number;
  drain_rate_pct_hr: number;
}

interface DailySleep {
  date: string;
  sleep_hours: number;
  drain_pct: number;
}

interface SleepStats {
  avg_drain_rate: number;
  total_sleep_hours: number;
  session_count: number;
  efficiency_score: number;
  sessions: SleepSession[];
  daily: DailySleep[];
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ── Component ── */

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('Sleep Efficiency'));

  const [vehicleId, setVehicleId] = useState<string>('');

  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data, isLoading, error } = useQuery<SleepStats>({
    queryKey: ['sleep-stats', activeId],
    queryFn: () => request<SleepStats>(`/vampire-drain/stats?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('start_date');

  const sortedSessions = useMemo(() => {
    if (!data?.sessions) return [];
    return sortFn(data.sessions, (row, key) => {
      const val = row[key as keyof SleepSession];
      return typeof val === 'number' ? val : String(val);
    });
  }, [data?.sessions, sortFn]);

  const columns: Column<SleepSession>[] = useMemo(() => [
    { key: 'start_date', header: t('Time'), sortable: true, render: (r) => formatDateTime(r.start_date) },
    { key: 'duration_hours', header: t('Duration'), sortable: true, render: (r) => `${fmtNumber(r.duration_hours, 1)}h` },
    { key: 'start_battery', header: t('Start %'), sortable: true, render: (r) => `${fmtNumber(r.start_battery, 0)}%` },
    { key: 'end_battery', header: t('End %'), sortable: true, render: (r) => `${fmtNumber(r.end_battery, 0)}%` },
    { key: 'drain_pct', header: t('Drain %'), sortable: true, render: (r) => (
      <Badge variant={r.drain_pct > 3 ? 'danger' : r.drain_pct > 1 ? 'warning' : 'success'}>
        {fmtNumber(r.drain_pct, 1)}%
      </Badge>
    )},
    { key: 'drain_rate_pct_hr', header: t('Rate %/hr'), sortable: true, render: (r) => fmtNumber(r.drain_rate_pct_hr, 2) },
  ], [t]);

  const efficiencyColor = (data?.efficiency_score ?? 0) >= 90
    ? CHART_COLORS[1] : (data?.efficiency_score ?? 0) >= 70 ? CHART_COLORS[3] : CHART_COLORS[5];

  const tips = useMemo(() => [
    { icon: <Zap className="h-4 w-4" />, text: t('Disable Sentry Mode when parked at home to save 1-2% per day.') },
    { icon: <Moon className="h-4 w-4" />, text: t('Reduce third-party app polling intervals to let the car sleep faster.') },
    { icon: <BatteryWarning className="h-4 w-4" />, text: t('Avoid opening the app frequently — each wake cycle costs battery.') },
    { icon: <Activity className="h-4 w-4" />, text: t('Enable energy saving mode in vehicle settings for better standby.') },
  ], [t]);

  return (
    <PageContainer
      title={t('Sleep Efficiency')}
      subtitle={t('Vampire drain analysis and sleep session tracking')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      empty={!data}
      emptyMessage={t('No sleep data available. Data will appear after sleep/wake events.')}
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
        <div className={clsx('grid gap-4 grid-cols-2 lg:grid-cols-4')}>
          <MetricCard label={t('Avg Vampire Drain')} value={`${fmtNumber(data?.avg_drain_rate, 2)}%/hr`} icon={<BatteryWarning className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Total Sleep Time')} value={`${fmtNumber(data?.total_sleep_hours, 0)}h`} icon={<Moon className="h-4 w-4" />} color="cyan" />
          <MetricCard label={t('Sleep Sessions')} value={fmtNumber(data?.session_count, 0)} icon={<Clock className="h-4 w-4" />} color="green" />
          <MetricCard label={t('Sleep Efficiency')} value={`${fmtNumber(data?.efficiency_score, 1)}%`} icon={<Activity className="h-4 w-4" />} color="cyan" />
        </div>
      </FadeIn>

      {/* Gauge + Drain Trend */}
      <FadeIn delay={0.1}>
        <div className={clsx('grid gap-4 grid-cols-1 md:grid-cols-3')}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            {data ? (
              <RadialGauge
                value={Math.round(data.efficiency_score)}
                max={100}
                label={t('Efficiency')}
                unit="%"
                color={efficiencyColor}
                size={160}
              />
            ) : (
              <Skeleton width="160px" height={160} rounded />
            )}
          </GlassPanel>

          <GlassPanel className="col-span-1 md:col-span-2 p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('Vampire Drain Trend')}</span>
            {data?.daily && data.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.daily} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                  <YAxis tick={axisTick} unit="%/hr" width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="drain_pct" name={t('Drain %')} stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={220} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Daily Sleep Stats */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('Daily Sleep Stats')}</span>
          {data?.daily && data.daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.daily} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                <YAxis yAxisId="left" tick={axisTick} unit="h" width={40} />
                <YAxis yAxisId="right" orientation="right" tick={axisTick} unit="%" width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar yAxisId="left" dataKey="sleep_hours" name={t('Sleep Hours')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="drain_pct" name={t('Drain %')} fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton height={260} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Sleep Sessions Table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <div className={clsx('mb-3 flex items-center justify-between')}>
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t('Sleep Sessions')}</span>
            <Badge variant="neutral">{data?.session_count ?? 0} {t('sessions')}</Badge>
          </div>
          <DataTable<SleepSession>
            columns={columns}
            data={sortedSessions}
            keyExtractor={(r) => r.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            emptyMessage={t('No sleep sessions recorded yet.')}
            compact
          />
        </GlassPanel>
      </FadeIn>

      {/* Tips */}
      <FadeIn delay={0.4}>
        <GlassPanel glow="green" className="p-5">
          <div className={clsx('mb-3 flex items-center gap-2')}>
            <Lightbulb className="h-5 w-5 text-neon-green" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{t('Tips to Reduce Vampire Drain')}</span>
          </div>
          <ul className="space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className={clsx('flex items-start gap-2 text-sm text-[var(--text-secondary)]')}>
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
