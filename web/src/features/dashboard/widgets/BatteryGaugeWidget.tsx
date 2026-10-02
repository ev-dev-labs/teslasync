import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { LinearGauge } from '@/components/charts';
import { Badge } from '@/components/ui';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { gaugeTone } from '@/lib/tokens';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * Maps a state-of-charge percentage to the gauge fill colour. A
 * `null`/`undefined` level (a snapshot that has not landed yet) renders the
 * neutral grey rather than a misleading "critical" red.
 */
export function batteryColor(level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level)) return gaugeTone.neutral;
  if (level > 50) return gaugeTone.success;
  if (level > 20) return gaugeTone.warning;
  return gaugeTone.danger;
}

export default function BatteryGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: stateData?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  const state = stateData?.state;
  const isCompact = size.cols === 1 && size.rows === 1;
  const batteryLevel = knownNumber(state?.battery_level);

  return (
    <WidgetShell
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {batteryLevel != null ? (
          <LinearGauge
            value={batteryLevel}
            max={100}
            label={t('widget.battery', 'Battery')}
            unit="%"
            color={batteryColor(batteryLevel)}
            size={isCompact ? 70 : 110}
          />
        ) : state ? (
          <WidgetBigNumber value={null} label={t('widget.battery', 'Battery')} />
        ) : (
          <EmptyState
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            className="py-4"
          />
        )}
        {state?.is_charging && (
          <Badge variant="success" size="sm" className="self-start">
            <span aria-hidden="true">⚡</span> {t('widget.charging', 'Charging')}
          </Badge>
        )}
      </div>
    </WidgetShell>
  );
}
