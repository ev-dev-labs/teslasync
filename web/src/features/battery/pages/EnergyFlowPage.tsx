import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { useEnergyFlow } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function EnergyFlowPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useEnergyFlow(activeId);

  const isCharging = (data?.dc_charging_power ?? 0) > 0 || (data?.ac_charging_power ?? 0) > 0;
  const activePower = (data?.dc_charging_power ?? 0) > 0
    ? data?.dc_charging_power
    : data?.ac_charging_power;
  const powerSource = (data?.dc_charging_power ?? 0) > 0 ? 'DC' : (data?.ac_charging_power ?? 0) > 0 ? 'AC' : null;

  return (
    <PageContainer
      title={t('Energy Flow')}
      subtitle={t('Real-time energy flow and charging status')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No energy flow data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Card>
        <CardHeader
          title={t('Charging Status')}
          action={
            <Badge variant={isCharging ? 'success' : 'neutral'}>
              {isCharging ? `${powerSource} ${t('Charging')}` : t('Not Charging')}
            </Badge>
          }
        />
        {isCharging && activePower != null && (
          <p className="text-center text-3xl font-bold py-4">
            {activePower.toFixed(1)} <span className="text-sm text-gray-500">kW</span>
          </p>
        )}
      </Card>

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Pack Voltage')} value={data?.pack_voltage?.toFixed(1) ?? '—'} unit="V" />
        <StatCard label={t('Pack Current')} value={data?.pack_current?.toFixed(1) ?? '—'} unit="A" />
        <StatCard label={t('State of Charge')} value={data?.soc != null ? `${(data.soc ?? 0).toFixed(0)}%` : '—'} />
        <StatCard label={t('Energy Remaining')} value={data?.energy_remaining?.toFixed(1) ?? '—'} unit="kWh" />
      </Grid>

      <Card>
        <CardHeader title={t('Charge State')} />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {data?.charge_state ?? t('Unknown')}
        </p>
      </Card>

      <Card>
        <CardHeader title={t('Energy Flow History')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>
    </PageContainer>
  );
}
