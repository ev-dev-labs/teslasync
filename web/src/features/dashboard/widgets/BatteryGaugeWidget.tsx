import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetGaugeHero } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function BatteryGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;
  const isCompact = size.cols === 1 && size.rows === 1;

  const batteryColor = () => {
    if (!state) return '#374151';
    if (state.battery_level > 50) return '#10b981';
    if (state.battery_level > 20) return '#f59e0b';
    return '#ef4444';
  };

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
            value: state.battery_level,
            max: 100,
            label: t('widget.battery', 'Battery'),
            unit: '%',
            color: batteryColor(),
          }}
          compact={isCompact}
        >
          {state.is_charging && (
            <p className="text-[10px] text-neon-green mt-2 animate-pulse">
              ⚡ {t('widget.charging', 'Charging')}
            </p>
          )}
        </WidgetGaugeHero>
      ) : (
        <EmptyState
          icon={<Battery className="h-6 w-6" />}
          message={t('widget.noBattery', 'No battery data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
