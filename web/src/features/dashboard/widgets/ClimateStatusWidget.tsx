import { useTranslation } from 'react-i18next';
import { Thermometer, Snowflake, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, WidgetStatusGrid } from './shared';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function ClimateStatusWidget({ vehicleId }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: climateData, error, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useClimateLatest(id, 5_000);
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const hvacState = climateData
    ? resolveHvacActive(climateData.hvac_power, climateData.is_ac_on)
    : null;
  const loading = isLoading || (vehiclesLoading && !id);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = deriveDataState({
    data: climateData ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  });

  return (
    <WidgetShell
      title={t('widget.climate', 'Climate')}
      icon={<Thermometer className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={loading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {climateData ? (
        <div className="space-y-3">
          <WidgetStatGrid cols={2} stats={[
            { label: t('widget.cabin', 'Cabin'), value: climateData.inside_temp != null ? `${fmtInt(toTemperatureDisplay(climateData.inside_temp))}${tempUnit}` : '—' },
            { label: t('widget.outside', 'Outside'), value: climateData.outside_temp != null ? `${fmtInt(toTemperatureDisplay(climateData.outside_temp))}${tempUnit}` : '—' },
          ]} />
          <WidgetStatusGrid cells={[
            { id: 'hvac', label: t('widget.hvac', 'HVAC'), status: hvacState == null ? 'unknown' : hvacState ? 'ok' : 'inactive', statusLabel: hvacState == null ? t('hero.unknownStatus', 'Unknown') : hvacState ? t('widget.hvacOn', 'On') : t('widget.hvacOff', 'Off') },
            ...(climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? [{
              id: 'defrost', label: t('widget.defrost', 'Defrost'), status: 'ok' as const, statusLabel: climateData.defrost_mode, icon: <Snowflake className="size-4" />,
            }] : []),
            ...(climateData.battery_heater ? [{
              id: 'heater', label: t('widget.batHeater', 'Heater'), status: 'ok' as const, statusLabel: t('widget.hvacOn', 'On'), icon: <Zap className="size-4" />,
            }] : []),
          ]} />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Thermometer className="h-5 w-5" />}
          message={t('widget.noClimate', 'No climate data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
