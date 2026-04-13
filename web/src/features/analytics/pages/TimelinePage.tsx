import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Clock, ArrowRightLeft, Car, BatteryCharging, Moon, RefreshCw,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { request } from '@/api/client';

/* ─── Types ──────────────────────────────────────────────── */

interface StateTransition {
  id: number;
  vehicle_id: number;
  from_state: string;
  to_state: string;
  timestamp: string;
  duration_seconds: number;
}

interface DailyBreakdown {
  date: string;
  driving_hours: number;
  charging_hours: number;
  idle_hours: number;
  sleeping_hours: number;
}

interface StateSummary {
  total: number;
  driving: number;
  charging: number;
  idle: number;
  sleeping: number;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ─── Constants ──────────────────────────────────────────── */

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
  idle: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  offline: '#374151',
};

const STATE_BADGE: Record<string, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  driving: 'success',
  charging: 'info',
  idle: 'warning',
  sleeping: 'neutral',
  online: 'info',
  offline: 'danger',
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ─── Component ──────────────────────────────────────────── */

export default function TimelinePage() {
  const { t } = useTranslation();
  usePageTitle(t('Title'));
  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');
  const enabled = activeId !== '';

  const { data: timelineData, isLoading: tlLoading, refetch } = useQuery({
    queryKey: ['vehicle-timeline', activeId],
    queryFn: () =>
      request<{ transitions: StateTransition[] }>(
        `/vehicle-states/timeline?vehicle_id=${activeId}`,
      ),
    enabled,
  });

  const { data: summaryData, isLoading: sumLoading } = useQuery({
    queryKey: ['vehicle-summary', activeId],
    queryFn: () =>
      request<{ transitions: StateTransition[]; summary: StateSummary }>(
        `/vehicle-states/summary?vehicle_id=${activeId}`,
      ),
    enabled,
  });

  const { data: dailyData, isLoading: dayLoading } = useQuery({
    queryKey: ['vehicle-daily', activeId],
    queryFn: () => request<DailyBreakdown[]>(`/vehicle-states/daily?vehicle_id=${activeId}`),
    enabled,
  });

  const transitions = timelineData?.transitions ?? [];
  const summary = summaryData?.summary;
  const daily = dailyData ?? [];
  const isLoading = tlLoading || sumLoading || dayLoading;

  const totalDuration = useMemo(
    () => transitions.reduce((s, tr) => s + tr.duration_seconds, 0),
    [transitions],
  );

  /* ─── Table columns ─── */

  const columns = useMemo<Column<StateTransition>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <span className="text-sm">{formatDateTime(row.timestamp)}</span>
        ),
      },
      {
        key: 'from_state',
        header: t('From State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.from_state] ?? 'neutral'} size="sm">
            {row.from_state}
          </Badge>
        ),
      },
      {
        key: 'to_state',
        header: t('To State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.to_state] ?? 'neutral'} size="sm">
            {row.to_state}
          </Badge>
        ),
      },
      {
        key: 'duration',
        header: t('Duration'),
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium">
            {formatDuration(row.duration_seconds)}
          </span>
        ),
      },
    ],
    [t],
  );

  /* ─── Actions (vehicle selector + refresh) ─── */

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const actions = (
    <div className="flex items-center gap-3">
      {vehicleOptions.length > 1 && (
        <Select
          options={vehicleOptions}
          value={activeId}
          onChange={(e) => setVehicleId(e.target.value)}
          placeholder={t('Select Vehicle')}
        />
      )}
      <Button variant="ghost" onClick={() => refetch()}>
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('Title')}
      subtitle={t('Subtitle')}
      actions={actions}
      loading={isLoading && transitions.length === 0}
      empty={!isLoading && transitions.length === 0}
      emptyMessage={t('Empty')}
    >
      {/* Summary metric cards */}
      <FadeIn>
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label={t('Total Transitions')}
            value={summary?.total ?? 0}
            icon={<ArrowRightLeft className="h-5 w-5" />}
          />
          <MetricCard
            label={t('Driving Time')}
            value={formatHours(summary?.driving ?? 0)}
            icon={<Car className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('Charging Time')}
            value={formatHours(summary?.charging ?? 0)}
            icon={<BatteryCharging className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('Idle Sleep Time')}
            value={formatHours((summary?.idle ?? 0) + (summary?.sleeping ?? 0))}
            icon={<Moon className="h-5 w-5" />}
          />
        </div>
      </FadeIn>

      {/* State timeline bar */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mb-6 p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t('State Timeline')}
          </p>
          {transitions.length === 0 ? (
            <Skeleton height={32} />
          ) : (
            <div className="flex h-8 overflow-hidden rounded-full">
              {transitions.map((tr) => {
                const pct = totalDuration > 0
                  ? (tr.duration_seconds / totalDuration) * 100
                  : 0;
                if (pct < 0.3) return null;
                return (
                  <div
                    key={tr.id}
                    className={clsx('relative transition-all')}
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        STATE_COLORS[tr.to_state] ?? STATE_COLORS.offline,
                    }}
                    title={`${tr.to_state}: ${formatDuration(tr.duration_seconds)}`}
                  />
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {Object.entries(STATE_COLORS).map(([state, color]) => (
              <div key={state} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs capitalize text-[var(--text-muted)]">
                  {state}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Daily breakdown stacked chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mb-6 p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t('Daily Breakdown')}
          </p>
          {dayLoading ? (
            <Skeleton height={280} />
          ) : daily.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              message={t('No Daily Data')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={daily}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.5}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="driving_hours" stackId="s" fill={STATE_COLORS.driving} name={t('Driving')} />
                <Bar dataKey="charging_hours" stackId="s" fill={STATE_COLORS.charging} name={t('Charging')} />
                <Bar dataKey="idle_hours" stackId="s" fill={STATE_COLORS.idle} name={t('Idle')} />
                <Bar dataKey="sleeping_hours" stackId="s" fill={STATE_COLORS.sleeping} name={t('Sleeping')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* State transitions table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t('State Transitions')}
          </p>
          <DataTable
            columns={columns}
            data={transitions}
            keyExtractor={(row) => row.id}
            emptyMessage={t('No Transitions')}
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
