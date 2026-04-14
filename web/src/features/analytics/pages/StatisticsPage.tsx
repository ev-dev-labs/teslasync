import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, MapPin, Zap, DollarSign, Leaf,
  TrendingUp, Gauge, RefreshCw,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Select, Button } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StatisticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('statistics.title', 'Statistics'));

  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['period-stats', activeId],
    queryFn: () =>
      request<PeriodStats>(`/analytics/period-stats?vehicle_id=${activeId}`),
    enabled: !!activeId,
  });

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const avgDriveDistance = stats && stats.total_drives > 0
    ? stats.total_distance / stats.total_drives
    : 0;

  return (
    <PageContainer
      title={t('statistics.title', 'Statistics')}
      subtitle={t('statistics.subtitle', 'Lifetime vehicle statistics and records')}
      error={error as Error | null}
      actions={
        <div className={cn('flex items-center gap-2')}>
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
          {/* ---- Lifetime Stats (5 MetricCards) ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard
              label={t('statistics.totalDistance', 'Total Distance')}
              value={`${fmtInt(stats.total_distance)} km`}
              icon={<MapPin className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('statistics.totalDrives', 'Total Drives')}
              value={fmtInt(stats.total_drives)}
              icon={<TrendingUp className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('statistics.totalEnergy', 'Total Energy')}
              value={`${fmtNumber(stats.energy_used)} kWh`}
              icon={<Zap className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('statistics.totalCost', 'Total Cost')}
              value={`$${fmtInt(stats.total_cost)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="red"
            />
            <MetricCard
              label={t('statistics.co2Saved', 'CO₂ Saved')}
              value={`${fmtNumber(stats.co2_saved)} kg`}
              icon={<Leaf className="h-4 w-4" />}
              color="green"
            />
          </div>

          {/* ---- Efficiency + Averages ---- */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FadeIn delay={0.1}>
              <MetricCard
                label={t('statistics.avgDriveDistance', 'Avg Drive Distance')}
                value={`${fmtNumber(avgDriveDistance)} km`}
                icon={<MapPin className="h-4 w-4" />}
                color="cyan"
              />
            </FadeIn>
            <FadeIn delay={0.2}>
              <MetricCard
                label={t('statistics.avgEfficiency', 'Avg Efficiency')}
                value={`${fmtNumber(stats.avg_efficiency)} Wh/km`}
                icon={<Gauge className="h-4 w-4" />}
                color="green"
              />
            </FadeIn>
            <FadeIn delay={0.3}>
              <MetricCard
                label={t('statistics.costPerKm', 'Cost per km')}
                value={stats.total_distance > 0 ? `$${fmtNumber(stats.total_cost / stats.total_distance, 3)}` : '—'}
                icon={<DollarSign className="h-4 w-4" />}
                color="amber"
              />
            </FadeIn>
          </div>
        </FadeIn>
      )}
    </PageContainer>
  );
}
