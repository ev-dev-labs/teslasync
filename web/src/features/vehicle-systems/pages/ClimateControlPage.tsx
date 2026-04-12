import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useClimate } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';

function comfortBadge(inside: number, target: number): { variant: 'success' | 'warning' | 'danger'; label: string } {
  const delta = Math.abs(inside - target);
  if (delta <= 1) return { variant: 'success', label: 'Comfortable' };
  if (delta <= 3) return { variant: 'warning', label: 'Adjusting' };
  return { variant: 'danger', label: 'Far from target' };
}

export default function ClimateControlPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data, isLoading, error } = useClimate(activeId);
  const badge = comfortBadge(data?.insideTemp ?? 0, data?.driverTempSetting ?? 0);

  return (
    <PageContainer
      title={t('Climate Control')}
      subtitle={t('HVAC status, temperatures, and seat heaters')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No climate data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Inside Temp')} value={data?.insideTemp?.toFixed(1) ?? '--'} unit="°C" />
        <StatCard label={t('Outside Temp')} value={data?.outsideTemp?.toFixed(1) ?? '--'} unit="°C" />
        <StatCard label={t('HVAC Power')} value={data?.hvacPower?.toFixed(1) ?? '0'} unit="kW" />
        <StatCard label={t('Fan Speed')} value={data?.fanSpeed ?? 0} />
      </Grid>

      <Card>
        <CardHeader
          title={t('Thermal Comfort')}
          action={<Badge variant={badge.variant}>{t(badge.label)}</Badge>}
        />
        <KVList
          columns={2}
          items={[
            { label: t('Driver Setting'), value: `${data?.driverTempSetting ?? '--'}°C` },
            { label: t('Passenger Setting'), value: `${data?.passengerTempSetting ?? '--'}°C` },
            { label: t('AC'), value: data?.isAcOn ? t('On') : t('Off') },
            { label: t('Auto Climate'), value: data?.isAutoClimate ? t('On') : t('Off') },
          ]}
        />
      </Card>

      <Grid cols={{ default: 2, lg: 3 }} gap={4}>
        <Card>
          <CardHeader title={t('Seat Heaters')} />
          <KVList items={[
            { label: t('Driver'), value: `${data?.seatHeaterLeft ?? 0}/3` },
            { label: t('Passenger'), value: `${data?.seatHeaterRight ?? 0}/3` },
            { label: t('Rear Left'), value: `${data?.seatHeaterRearLeft ?? 0}/3` },
            { label: t('Rear Right'), value: `${data?.seatHeaterRearRight ?? 0}/3` },
            { label: t('Rear Center'), value: `${data?.seatHeaterRearCenter ?? 0}/3` },
          ]} />
        </Card>

        <Card>
          <CardHeader title={t('System Status')} />
          <KVList items={[
            { label: t('Climate Keeper'), value: data?.climateKeeperMode ?? t('Off') },
            { label: t('Defrost'), value: data?.defrostMode ? t('Active') : t('Off') },
            { label: t('Battery Heater'), value: data?.batteryHeater ? t('On') : t('Off') },
            { label: t('Steering Wheel'), value: data?.steeringWheelHeat ? t('On') : t('Off') },
          ]} />
        </Card>

        <Card>
          <CardHeader title={t('Protection')} />
          <KVList items={[
            { label: t('Overheat Protection'), value: data?.overheatProtection ?? t('Unknown') },
          ]} />
        </Card>
      </Grid>
    </PageContainer>
  );
}
