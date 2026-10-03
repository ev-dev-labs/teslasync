import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { LinearGauge } from '@/components/charts';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

export default function BatteryHealthAnalyticsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const query = useBatteryHealthAnalytics(vehicleIdStr);
  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState(query, { provenance: 'inferred' });

  const isCompact = size.cols <= 1;
  const healthScore = knownNumber(data?.current_soh);
  const reading = (value: unknown, precision = getGlobalPrecision()) => {
    const number = knownNumber(value);
    return number == null ? null : fmtNumber(number, precision);
  };

  const stats = [
    {
      label: t('widget.batteryHealthAnalytics.totalCycles', 'Cycles'),
      value: knownNumber(data?.total_cycles) != null ? fmtInt(data?.total_cycles) : null,
    },
    {
      label: t('widget.batteryHealthAnalytics.avgChargeDepth', 'Charge depth'),
      value: reading(data?.full_charge_pct),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge'),
      value: reading(data?.avg_depth_of_discharge_pct),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.dcFastRatio', 'DC fast'),
      value: reading(data?.fast_charge_pct),
      unit: '%',
    },
    {
      label: t('widget.batteryHealthAnalytics.tempExposure', 'Temp score'),
      value: reading(data?.temp_exposure_score),
      unit: `/ 100`,
    },
    {
      label: t('widget.batteryHealthAnalytics.chargeHabits', 'Habits'),
      value: reading(data?.charge_habits_score),
      unit: `/ 100`,
    },
  ];

  const shellProps = {
    loading: isLoading,
    dataState: data != null || isLoading || isError || error ? trust : undefined,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryHealthAnalytics.title', 'Battery analytics')}
      icon={<HeartPulse className="h-3.5 w-3.5" />}
      {...shellProps}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {healthScore != null ? (
          <LinearGauge
            value={healthScore}
            max={100}
            label={t('widget.batteryHealthAnalytics.score', 'health')}
            unit="%"
            tone={healthScore >= 80 ? 'success' : healthScore >= 50 ? 'warning' : 'danger'}
            size={isCompact ? 70 : 110}
          />
        ) : data ? (
          <WidgetBigNumber value={null} label={t('widget.batteryHealthAnalytics.score', 'health')} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<HeartPulse className="h-5 w-5" />}
            message={t('widget.batteryHealthAnalytics.noData', 'No battery health data')}
            className="py-4"
          />
        )}
        {!isCompact && <WidgetStatGrid stats={stats} cols={3} />}
      </div>
    </WidgetShell>
  );
}
