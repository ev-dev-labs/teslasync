import { useTranslation } from 'react-i18next';
import { Thermometer, Snowflake, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-sm font-bold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export default function ClimateStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: climateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useClimateLatest(id, 5_000);
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const hvacState = climateData
    ? resolveHvacActive(climateData.hvac_power, climateData.is_ac_on)
    : null;

  return (
    <WidgetShell
      title={t('widget.climate', 'Climate')}
      icon={<Thermometer className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {climateData ? (
        <div className="space-y-2.5">
          <Row
            label={t('widget.cabin', 'Cabin')}
            value={
              climateData.inside_temp != null
                ? `${fmtInt(toTemperatureDisplay(climateData.inside_temp))}${tempUnit}`
                : '—'
            }
          />
          <Row
            label={t('widget.outside', 'Outside')}
            value={
              climateData.outside_temp != null
                ? `${fmtInt(toTemperatureDisplay(climateData.outside_temp))}${tempUnit}`
                : '—'
            }
          />
          <Row
            label={t('widget.hvac', 'HVAC')}
            value={hvacState == null
              ? '—'
              : hvacState
                ? t('widget.hvacOn', 'On')
                : t('widget.hvacOff', 'Off')}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {climateData.defrost_mode && climateData.defrost_mode !== 'Off' && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                <Snowflake className="h-2.5 w-2.5" /> {t('widget.defrost', 'Defrost')}
              </span>
            )}
            {climateData.battery_heater && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
                <Zap className="h-2.5 w-2.5" /> {t('widget.batHeater', 'Heater')}
              </span>
            )}
          </div>
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
