import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetGaugeHero } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * Maps a state-of-charge percentage to the gauge fill colour. A
 * `null`/`undefined` level (a snapshot that has not landed yet) renders the
 * neutral grey rather than a misleading "critical" red.
 */
export function batteryColor(level: number | null | undefined): string {
  if (level == null) return '#374151'; // no data — neutral grey
  if (level > 50) return '#10b981'; // green
  if (level > 20) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

export default function BatteryGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;
  const isCompact = size.cols === 1 && size.rows === 1;
  const batteryLevel = state?.battery_level ?? 0;

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {state ? (
        <WidgetGaugeHero
          gauge={{
            value: batteryLevel,
            max: 100,
            label: t('widget.battery', 'Battery'),
            unit: '%',
            color: batteryColor(batteryLevel),
          }}
          compact={isCompact}
        >
          {state.is_charging && (
            <p className="text-2xs text-emerald-300 mt-2 animate-pulse">
              <span aria-hidden="true">⚡</span> {t('widget.charging', 'Charging')}
            </p>
          )}
        </WidgetGaugeHero>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Battery className="h-6 w-6" />}
          message={t('widget.noBattery', 'No battery data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
