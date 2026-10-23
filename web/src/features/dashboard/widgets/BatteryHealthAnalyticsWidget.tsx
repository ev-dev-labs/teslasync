import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function BatteryHealthAnalyticsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
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

  // After card: pill('Good','ok') beside the hero. Thresholds keep the
  // previous gauge tones (>=80 good, 50-79 fair, <50 poor) as dot+word.
  // Dedicated batteryHealthAnalytics status keys do not exist yet, so the
  // existing Good/Fair/Poor catalog keys are reused (see unresolved report).
  const healthPill = healthScore == null
    ? null
    : healthScore >= 80
      ? { text: t('widget.projectedRange.good', 'Good'), variant: 'success' as const }
      : healthScore >= 50
        ? { text: t('widget.projectedRange.fair', 'Fair'), variant: 'warning' as const }
        : { text: t('widget.projectedRange.poor', 'Poor'), variant: 'danger' as const };

  // After card stats (4): Full cycles / Avg depth / DC fast share /
  // Time > 35 °C. No field measures time above 35 °C, so the fourth tile
  // keeps the honest existing temperature-exposure score instead of
  // fabricating a percentage (data gap reported to the orchestrator).
  // Whole numbers per spec rule 2; measured 0 stays 0, missing stays null.
  const fmtStat = (raw: number | null) => (raw == null ? null : fmtInt(raw));
  const stats: StatGridItem[] = [
    { label: t('widget.batteryHealthAnalytics.totalCycles', 'Cycles'), value: fmtStat(knownNumber(data?.total_cycles)) },
    { label: t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge'), value: fmtStat(knownNumber(data?.avg_depth_of_discharge_pct)), unit: '%' },
    { label: t('widget.batteryHealthAnalytics.dcFastRatio', 'DC fast'), value: fmtStat(knownNumber(data?.fast_charge_pct)), unit: '%' },
    { label: t('widget.batteryHealthAnalytics.tempExposure', 'Temp score'), value: fmtStat(knownNumber(data?.temp_exposure_score)), unit: '/ 100' },
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
      title={t('widget.batteryHealthAnalytics.title', 'Battery analytics')}
      icon={<HeartPulse className="h-3.5 w-3.5" />}
      {...shellProps}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {healthScore != null ? (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <WidgetBigNumber
              value={healthScore}
              unit="%"
              label={t('widget.batteryHealthAnalytics.score', 'health')}
              decimals={0}
              animated={false}
            />
            {healthPill && (
              <Badge variant={healthPill.variant} size="sm">{healthPill.text}</Badge>
            )}
          </div>
        ) : data ? (
          <WidgetBigNumber value={null} label={t('widget.batteryHealthAnalytics.score', 'health')} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<HeartPulse className="h-5 w-5" />}
            message={t('widget.batteryHealthAnalytics.noData', 'No battery health data')}
            className="py-4"
          />
        )}
        {!isCompact && data && <WidgetStatGrid stats={stats} cols={4} />}
      </div>
    </WidgetShell>
  );
}
