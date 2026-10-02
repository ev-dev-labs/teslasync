import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { LinearGauge } from '@/components/charts';
import { Badge } from '@/components/ui';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { batteryColor } from './BatteryGaugeWidget';
import type { WidgetProps } from './types';

export default function BatteryLinearGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: stateData?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isLarge = size.cols >= 2 && size.rows >= 2;

  const batteryLevel = knownNumber(state?.battery_level);
  // charge_limit_soc may be present on extended state payloads. Validate it is
  // a finite number before use so a malformed field never leaks a NaN into the
  // gauge overlay or the stat row.
  const chargeLimitRaw = (state as Record<string, unknown> | undefined)?.charge_limit_soc;
  const chargeLimitSoc =
    typeof chargeLimitRaw === 'number' && Number.isFinite(chargeLimitRaw) && chargeLimitRaw >= 0 && chargeLimitRaw <= 100 ? chargeLimitRaw : undefined;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryLevel', 'Battery')}
      icon={isCompact ? undefined : <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {batteryLevel != null ? (
          <LinearGauge
            value={batteryLevel}
            max={100}
            label={t('widget.level', 'Level')}
            ariaLabel={t('widget.batteryLevel', 'Battery')}
            unit="%"
            color={batteryColor(batteryLevel)}
            size={isCompact ? 70 : 110}
            marker={chargeLimitSoc}
            markerLabel={chargeLimitSoc != null ? `${t('widget.chargeLimit', 'Limit')} ${chargeLimitSoc}%` : undefined}
          />
        ) : state ? (
          <WidgetBigNumber value={null} label={t('widget.level', 'Level')} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            className="py-4"
          />
        )}
        {isLarge && chargeLimitSoc != null && (
          <WidgetStatGrid stats={[{ label: t('widget.chargeLimit', 'Limit'), value: chargeLimitSoc, unit: '%' }]} />
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
