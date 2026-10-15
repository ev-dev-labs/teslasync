import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { LinearGauge } from '@/components/charts';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import type { StatMetric } from '@/components/data-display';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const sourceMetrics: StatMetric[] = [
    { metricId: 'number', occurrenceId: 'battery-health-cycles', rawValue: data?.total_cycles,
      label: t('widget.batteryHealthAnalytics.totalCycles', 'Cycles'),
      description: t('widget.batteryHealthAnalytics.cyclesSource', 'Returned cycle measurement; the existing whole-number display is retained.'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'battery-health-charge-depth', rawValue: data?.full_charge_pct, label: t('widget.batteryHealthAnalytics.avgChargeDepth', 'Charge depth') },
    { metricId: 'percent', occurrenceId: 'battery-health-discharge-depth', rawValue: data?.avg_depth_of_discharge_pct, label: t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge') },
    { metricId: 'percent', occurrenceId: 'battery-health-fast-charge', rawValue: data?.fast_charge_pct, label: t('widget.batteryHealthAnalytics.dcFastRatio', 'DC fast') },
    { metricId: 'score', occurrenceId: 'battery-health-temperature-score', rawValue: data?.temp_exposure_score, label: t('widget.batteryHealthAnalytics.tempExposure', 'Temp score') },
    { metricId: 'score', occurrenceId: 'battery-health-habits-score', rawValue: data?.charge_habits_score, label: t('widget.batteryHealthAnalytics.chargeHabits', 'Habits') },
  ];
  const metrics = sourceMetrics.map(metric => metric.display ? metric : ({
    ...metric,
    display: { formatter: (raw: number) => ({
      value: fmtNumber(raw), unit: metric.metricId === 'score' ? '/ 100' : '%',
    }) },
  }));

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
      title={t('widget.batteryHealthAnalytics.title', 'Battery analytics')}
      icon={<HeartPulse className="h-3.5 w-3.5" />}
      {...shellProps}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {healthScore != null ? (
          <LinearGauge
            preserveReadingAndScale
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
        {!isCompact && <DashboardSourceBrief metrics={metrics} state={trust}
          eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
          title={t('widget.batteryHealthAnalytics.summaryTitle', 'Returned battery-health factors')}
          description={t('widget.batteryHealthAnalytics.summaryDescription', 'Source cycle, charge-depth, fast-charge and habit measurements retain their independent meanings; the health gauge remains separate.')}
          scope={t('widget.batteryHealthAnalytics.summaryScope', 'Vehicle {{id}} · returned inferred battery analytics; continuous coverage is unknown.', { id: vid ?? '—' })}
          loading={isLoading && !data} testId="dashboard-battery-health-brief" />}
      </div>
    </WidgetShell>
  );
}
