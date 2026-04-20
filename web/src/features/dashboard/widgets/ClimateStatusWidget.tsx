import { useTranslation } from 'react-i18next';
import { Thermometer, Snowflake, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-white/50">{label}</span>
      <span className="text-sm font-bold text-white/90">{value}</span>
    </div>
  );
}

export default function ClimateStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: climateData, isLoading } = useClimateLatest(id, 5_000);
  const { convertTemp, tempUnit } = useSettings();

  return (
    <WidgetShell
      title={t('widget.climate', 'Climate')}
      icon={<Thermometer className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
    >
      {climateData ? (
        <div className="space-y-2.5">
          <Row
            label={t('widget.cabin', 'Cabin')}
            value={
              climateData.inside_temp != null
                ? `${fmtInt(convertTemp(climateData.inside_temp))}${tempUnit}`
                : '—'
            }
          />
          <Row
            label={t('widget.outside', 'Outside')}
            value={
              climateData.outside_temp != null
                ? `${fmtInt(convertTemp(climateData.outside_temp))}${tempUnit}`
                : '—'
            }
          />
          <Row
            label={t('widget.hvac', 'HVAC')}
            value={
              climateData.hvac_power != null ? `${fmtNumber(climateData.hvac_power, 1)} kW` : '—'
            }
          />
          <div className="flex items-center gap-2 flex-wrap">
            {climateData.defrost_mode && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                <Snowflake className="h-2.5 w-2.5" /> {t('widget.defrost', 'Defrost')}
              </span>
            )}
            {climateData.battery_heater_on && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
                <Zap className="h-2.5 w-2.5" /> {t('widget.batHeater', 'Heater')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Thermometer className="h-5 w-5" />}
          message={t('widget.noClimate', 'No climate data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
