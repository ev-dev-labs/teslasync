import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
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

  const formatTemp = (raw: number | null | undefined): string | null =>
    raw != null && Number.isFinite(raw) ? fmtInt(toTemperatureDisplay(raw)) : null;
  const insideValue = climateData ? formatTemp(climateData.inside_temp) : null;
  const outsideValue = climateData ? formatTemp(climateData.outside_temp) : null;

  const hvacPill = hvacState === true
    ? { text: t('widget.climatePanel.hvacOn', 'HVAC on'), variant: 'success' as const }
    : hvacState === false
      ? { text: t('widget.climatePanel.hvacOff', 'HVAC off'), variant: 'neutral' as const }
      : { text: t('widget.climatePanel.hvacUnknown', 'HVAC unknown'), variant: 'neutral' as const };

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
        <div className="flex flex-col items-start">
          <WidgetBigNumber
            value={insideValue}
            unit={tempUnit}
            label={t('hero.inside', 'Inside')}
          />
          <span className={`${dashboardTokens.metricLabel} mt-1.5`}>
            {t('widget.outside', 'Outside')} {outsideValue != null ? `${outsideValue}${tempUnit}` : '—'}
          </span>
          <div className="mt-3">
            <Badge variant={hvacPill.variant} size="sm">{hvacPill.text}</Badge>
          </div>
        </div>
      ) : (
        <EmptyState
          variant="informational"
          icon={<Thermometer className="h-5 w-5" />}
          message={t('widget.noClimate', 'No climate data')}
          description={t('widget.noClimateDescription', 'Climate readings will appear after the vehicle sends its next telemetry update.')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
