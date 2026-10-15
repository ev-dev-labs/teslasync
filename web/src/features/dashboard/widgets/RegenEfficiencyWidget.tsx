import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useRegenEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetGaugeHero } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function regenColor(pct: number): string {
  if (pct > 30) return '#10b981';
  if (pct > 15) return '#f59e0b';
  return '#ef4444';
}

export default function RegenEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatEnergy } = useUnits();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const query = useRegenEfficiency(vehicleIdStr);
  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const isCompact = size.cols <= 1;

  // `/analytics/regen` already returns regen_ratio as a percentage
  // (regenWh / driveWh * 100, see internal/api/regen/handler.go). Do not
  // scale it again — that pinned the gauge at max and forced regenColor green.
  const regenPct = knownNumber(data?.regenRatio);
  const color = useMemo(() => regenPct == null ? '#94a3b8' : regenColor(regenPct), [regenPct]);

  const gaugeConfig = useMemo(() => ({
    value: regenPct,
    preserveReadingAndScale: true,
    max: 100,
    label: regenPct == null ? '—' : `${fmtNumber(regenPct)}%`,
    unit: t('widget.regenEfficiency.recovery', 'recovery'),
    color,
  }), [regenPct, color, t]);

  const shellProps = {
    loading: isLoading,
    dataState: data != null || isLoading || isError || error ? trust : undefined,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.regenEfficiency.title', 'Regen braking')} {...shellProps}>
        <div className="flex min-w-0 flex-col gap-2">
          {data ? (
            regenPct != null ? <WidgetGaugeHero gauge={gaugeConfig} compact /> : (
              <WidgetBigNumber value={null} label={t('widget.regenEfficiency.recovery', 'recovery')} />
            )
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<RotateCcw className="h-5 w-5" />}
              message={t('widget.regenEfficiency.noData', 'No regen data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.regenEfficiency.title', 'Regen braking')}
      icon={<RotateCcw className="h-3.5 w-3.5 text-emerald-400" />}
      help={{
        i18nKey: 'help.regenEfficiency.body',
        defaultValue:
          'Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.',
      }}
      {...shellProps}
    >
      <DashboardSourceBrief
        metrics={[
          { metricId: 'energy', rawValue: knownNumber(data?.totalRegenWh), label: t('widget.regenEfficiency.totalKwh', 'Total recovered'), description: t('widget.regenEfficiency.recoveredDescription', 'Reported regenerative energy in watt-hours; average absolute drive power is not regenerative power.'), display: { formatter: raw => ({ value: formatEnergy(Number(raw)), unit: '' }) } },
          { metricId: 'energy', rawValue: knownNumber(data?.totalDriveWh), label: t('widget.regenEfficiency.driveEnergy', 'Drive energy'), description: t('widget.regenEfficiency.driveDescription', 'Reported drive energy in watt-hours, independent of the displayed recovery percentage.'), display: { formatter: raw => ({ value: formatEnergy(Number(raw)), unit: '' }) } },
          { metricId: 'count', rawValue: knownNumber(data?.freeCharges), label: t('widget.regenEfficiency.freeCharges', 'Free charges'), description: t('widget.regenEfficiency.chargesDescription', 'Source-reported equivalent free-charge count; missing values remain unknown.') },
        ]}
        state={trust} eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
        title={t('widget.regenEfficiency.summaryTitle', 'Regenerative energy sources')}
        description={t('widget.regenEfficiency.summaryDescription', 'Recovered and used energy retain the source quantities; the existing recovery gauge is a percentage and is never scaled twice.')}
        scope={t('widget.regenEfficiency.summaryScope', 'Vehicle {{vehicleId}}; returned analytics window, exact source bounds unknown', { vehicleId: vid ?? '—' })}
        loading={isLoading && !data} testId="regen-efficiency-operational-brief"
      />
      {data ? (
        <div className="flex min-w-0 flex-col gap-3">
          {regenPct != null ? <WidgetGaugeHero gauge={gaugeConfig} /> : (
            <WidgetBigNumber value={null} label={t('widget.regenEfficiency.recovery', 'recovery')} />
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<RotateCcw className="h-5 w-5" />}
          message={t('widget.regenEfficiency.noData', 'No regen data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
