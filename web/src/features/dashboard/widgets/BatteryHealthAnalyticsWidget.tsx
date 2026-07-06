import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export default function BatteryHealthAnalyticsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = useBatteryHealthAnalytics(vehicleIdStr);

  const isCompact = size.cols <= 1;
  const hasData = !!data;
  // Only replace the whole widget with a full-panel error on the INITIAL
  // load failure, when there is no cached data to fall back on. Once we have
  // data, a transient background-refetch failure must not blank out
  // otherwise-valid numbers — it is surfaced through the freshness
  // indicator's error state instead (WidgetShell forwards `isError` to
  // <DataFreshness>).
  const blockingError = !hasData && error ? String(error) : null;

  const healthScore = data?.current_soh ?? 0;
  const color = useMemo(() => scoreColor(healthScore), [healthScore]);

  const gaugeConfig = useMemo(() => ({
    value: healthScore,
    max: 100,
    label: `${fmtInt(healthScore)}`,
    unit: t('widget.batteryHealthAnalytics.score', 'health'),
    color,
  }), [healthScore, color, t]);

  const stats: GaugeHeroStat[] = useMemo(() => [
    {
      label: t('widget.batteryHealthAnalytics.totalCycles', 'Cycles'),
      value: fmtInt(data?.total_cycles ?? 0),
    },
    {
      label: t('widget.batteryHealthAnalytics.avgChargeDepth', 'Charge Depth'),
      value: fmtNumber((data?.full_charge_pct ?? 0), 0),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge'),
      value: fmtNumber((data?.avg_depth_of_discharge ?? 0), 0),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.dcFastRatio', 'DC Fast'),
      value: fmtNumber((data?.fast_charge_pct ?? 0), 0),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.tempExposure', 'Temp Score'),
      value: fmtInt(data?.temp_exposure_score ?? 0),
      unit: `/ 100`,
    },
    {
      label: t('widget.batteryHealthAnalytics.chargeHabits', 'Habits'),
      value: fmtInt(data?.charge_habits_score ?? 0),
      unit: `/ 100`,
    },
  ], [data, t]);

  const shellProps = {
    loading: isLoading,
    error: blockingError,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
          {hasData ? (
            <WidgetGaugeHero gauge={gaugeConfig} compact />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<HeartPulse className="h-5 w-5" />}
              message={t('widget.batteryHealthAnalytics.noData', 'No battery health data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.batteryHealthAnalytics.title', 'Battery Analytics')}
      icon={<HeartPulse className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {hasData ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<HeartPulse className="h-5 w-5" />}
          message={t('widget.batteryHealthAnalytics.noData', 'No battery health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
