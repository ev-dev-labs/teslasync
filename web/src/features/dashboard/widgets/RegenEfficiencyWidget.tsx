import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useRegenEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

function regenColor(pct: number): string {
  if (pct > 30) return '#10b981';
  if (pct > 15) return '#f59e0b';
  return '#ef4444';
}

export default function RegenEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatEnergy } = useUnits();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useRegenEfficiency(vehicleIdStr);

  const isCompact = size.cols <= 1;

  // `/analytics/regen` already returns regen_ratio as a percentage
  // (regenWh / driveWh * 100, see internal/api/regen/handler.go). Do not
  // scale it again — that pinned the gauge at max and forced regenColor green.
  const regenPct = data?.regenRatio ?? 0;
  const color = useMemo(() => regenColor(regenPct), [regenPct]);

  const stats: GaugeHeroStat[] = useMemo(() => [
    {
      label: t('widget.regenEfficiency.totalKwh', 'Total Recovered'),
      value: formatEnergy(data?.totalRegenWh, { precision: 1 }),
    },
    // Do not surface `monthlyAvgRegen`: despite its legacy name, the backend
    // field is average absolute drive power, not measured regenerative power.
    {
      label: t('widget.regenEfficiency.driveEnergy', 'Drive Energy'),
      value: formatEnergy(data?.totalDriveWh, { precision: 1 }),
    },
    {
      label: t('widget.regenEfficiency.freeCharges', 'Free Charges'),
      value: fmtInt(data?.freeCharges ?? 0),
    },
  ], [data, t, formatEnergy]);

  const gaugeConfig = useMemo(() => ({
    value: Math.round(regenPct),
    max: 100,
    label: `${Math.round(regenPct)}%`,
    unit: t('widget.regenEfficiency.recovery', 'recovery'),
    color,
  }), [regenPct, color, t]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
          {data ? (
            <WidgetGaugeHero gauge={gaugeConfig} compact />
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
      title={t('widget.regenEfficiency.title', 'Regen Braking')}
      icon={<RotateCcw className="h-3.5 w-3.5 text-emerald-400" />}
      help={{
        i18nKey: 'help.regenEfficiency.body',
        defaultValue:
          'Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.',
      }}
      {...shellProps}
    >
      {data ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
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
