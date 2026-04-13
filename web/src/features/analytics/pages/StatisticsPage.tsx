import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3, MapPin, Zap, Battery, DollarSign, Leaf,
  Trophy, TrendingUp, Gauge, RefreshCw,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

interface LifetimeStats {
  total_distance: number;
  total_drives: number;
  total_charging_sessions: number;
  total_energy_kwh: number;
  total_cost: number;
  co2_saved_kg: number;
  avg_efficiency: number;
  avg_drive_distance: number;
  avg_charge_energy: number;
  monthly_distance: { month: string; distance: number }[];
  records: {
    longest_drive_km: number;
    fastest_charge_kw: number;
    most_efficient_wh_km: number;
    highest_charge_kwh: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StatisticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Title'));

  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['lifetime-stats', activeId],
    queryFn: () =>
      request<LifetimeStats>(`/analytics/lifetime?vehicle_id=${activeId}`),
    enabled: !!activeId,
  });

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const pieData = stats
    ? [
        { name: t('Driving'), value: stats.total_drives },
        { name: t('Charging'), value: stats.total_charging_sessions },
      ]
    : [];

  const records = stats?.records;

  const recordItems = records
    ? [
        { label: t('Longest Drive'), value: `${fmtNumber(records.longest_drive_km)} km`, icon: <MapPin className="h-4 w-4 text-cyan-400" /> },
        { label: t('Fastest Charge'), value: `${fmtNumber(records.fastest_charge_kw)} kW`, icon: <Zap className="h-4 w-4 text-amber-400" /> },
        { label: t('Most Efficient'), value: `${fmtNumber(records.most_efficient_wh_km)} Wh/km`, icon: <Gauge className="h-4 w-4 text-green-400" /> },
        { label: t('Highest Charge'), value: `${fmtNumber(records.highest_charge_kwh)} kWh`, icon: <Battery className="h-4 w-4 text-purple-400" /> },
      ]
    : [];

  return (
    <PageContainer
      title={t('Title')}
      subtitle={t('Subtitle')}
      error={error as Error | null}
      actions={
        <div className={clsx('flex items-center gap-2')}>
          {vehicleOptions.length > 1 && (
            <Select
              value={activeId}
              onChange={(e) => setVehicleId(e.target.value)}
              options={vehicleOptions}
              placeholder={t('Select Vehicle')}
            />
          )}
          <Button size="sm" onClick={() => { void refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={96} rounded />
          ))}
        </div>
      ) : !stats ? (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title={t('No Data')}
          message={t('No Data Message')}
        />
      ) : (
        <FadeIn>
          {/* ---- Lifetime Stats (6 MetricCards) ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label={t('Total Distance')}
              value={`${fmtInt(stats.total_distance)} km`}
              icon={<MapPin className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('Total Drives')}
              value={fmtInt(stats.total_drives)}
              icon={<TrendingUp className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('Charging Sessions')}
              value={fmtInt(stats.total_charging_sessions)}
              icon={<Battery className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('Total Energy')}
              value={`${fmtNumber(stats.total_energy_kwh)} kWh`}
              icon={<Zap className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('Total Cost')}
              value={`$${fmtInt(stats.total_cost)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="red"
            />
            <MetricCard
              label={t('statistics.co2Saved', 'Co2Saved')}
              value={`${fmtNumber(stats.co2_saved_kg)} kg`}
              icon={<Leaf className="h-4 w-4" />}
              color="green"
            />
          </div>

          {/* ---- Charts Row ---- */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Monthly Distance BarChart */}
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
                {t('Monthly Distance')}
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.monthly_distance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="distance" fill={CHART_COLORS[0]} name={t('Distance')} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </GlassPanel>

            {/* Driving vs Charging PieChart */}
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
                {t('Driving Vs Charging')}
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={`cell-${CHART_COLORS[i]}`} fill={CHART_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </GlassPanel>
          </div>

          {/* ---- Personal Records ---- */}
          <GlassPanel className="mt-6 p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Personal Records')}
              </span>
              <Badge variant="warning" size="sm">
                {t('Best')}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {recordItems.map((item) => (
                <GlassPanel key={item.label} hover className="p-3">
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <span className="text-xs text-[var(--text-secondary)]">
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                    {item.value}
                  </p>
                </GlassPanel>
              ))}
            </div>
          </GlassPanel>

          {/* ---- Averages ---- */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FadeIn delay={0.1}>
              <MetricCard
                label={t('Avg Drive Distance')}
                value={`${fmtNumber(stats.avg_drive_distance)} km`}
                icon={<MapPin className="h-4 w-4" />}
                color="cyan"
              />
            </FadeIn>
            <FadeIn delay={0.2}>
              <MetricCard
                label={t('Avg Charge Energy')}
                value={`${fmtNumber(stats.avg_charge_energy)} kWh`}
                icon={<Zap className="h-4 w-4" />}
                color="green"
              />
            </FadeIn>
            <FadeIn delay={0.3}>
              <MetricCard
                label={t('Avg Efficiency')}
                value={`${fmtNumber(stats.avg_efficiency)} Wh/km`}
                icon={<Gauge className="h-4 w-4" />}
                color="purple"
              />
            </FadeIn>
          </div>
        </FadeIn>
      )}
    </PageContainer>
  );
}
