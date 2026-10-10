import { useTranslation } from 'react-i18next';
import { Thermometer, Snowflake, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display';
import { deriveDataState } from '@/api/dataState';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetStatusGrid } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
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
  const temperatureMetrics: StatMetric[] = [
    { metricId: 'temperature', occurrenceId: 'climate-cabin-temperature', rawValue: climateData?.inside_temp,
      label: t('widget.cabin', 'Cabin'),
      display: { formatter: raw => ({ value: fmtInt(toTemperatureDisplay(raw)), unit: tempUnit }) } },
    { metricId: 'temperature', occurrenceId: 'climate-outside-temperature', rawValue: climateData?.outside_temp,
      label: t('widget.outside', 'Outside'),
      display: { formatter: raw => ({ value: fmtInt(toTemperatureDisplay(raw)), unit: tempUnit }) } },
  ];

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
          <DashboardSourceBrief metrics={temperatureMetrics} state={dataState}
            eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
            title={t('widget.climateSummaryTitle', 'Returned climate temperatures')}
            description={t('widget.climateSummaryDescription', 'Cabin and outside temperatures remain separate SI measurements, converted only for display; HVAC, defrost and heater states remain below.')}
            scope={t('widget.climateSummaryScope', 'Vehicle {{id}} · returned climate snapshot; continuous recording coverage is not established.', { id })}
            testId="dashboard-climate-temperatures-brief" />
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
