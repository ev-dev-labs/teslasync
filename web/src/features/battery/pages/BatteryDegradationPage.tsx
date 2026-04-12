import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function BatteryDegradationPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useBatteryDegradation(activeId);

  const stressVariant = data?.stress_level === 'Low' ? 'success' as const
    : data?.stress_level === 'Medium' ? 'warning' as const
    : 'danger' as const;

  return (
    <PageContainer
      title={t('Battery Degradation')}
      subtitle={t('Health trends, predictions and charging habit impact')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data || data.snapshots.length === 0}
      emptyMessage={t('Not enough data to display degradation trends.')}
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
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Health')} value={`${data?.current_health?.toFixed(1) ?? '0'}%`} />
        <StatCard label={t('Capacity')} value={data?.current_capacity?.toFixed(1) ?? '0'} unit="kWh" />
        <StatCard label={t('Cycles')} value={data?.current_cycles ?? 0} />
        <StatCard label={t('Range')} value={data?.current_range?.toFixed(0) ?? '0'} unit="km" />
      </Grid>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader
            title={t('Prediction')}
            action={
              data?.prediction?.has_enough_data
                ? <Badge variant="info">{t('~{{years}} years to 80%', { years: data.prediction.years_to_80_pct?.toFixed(1) })}</Badge>
                : <Badge variant="neutral">{t('Insufficient data')}</Badge>
            }
          />
          {data?.prediction?.has_enough_data ? (
            <div className="space-y-2 text-sm">
              <p>{t('Degradation rate')}: <strong>{Math.abs(data.prediction.slope_per_year).toFixed(2)}%/yr</strong></p>
              {data.prediction.predicted_date && <p>{t('Predicted 80% date')}: <strong>{data.prediction.predicted_date}</strong></p>}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('Need at least 3 snapshots to generate prediction.')}</p>
          )}
        </Card>

        <Card>
          <CardHeader title={t('Stress Level')} action={<Badge variant={stressVariant}>{data?.stress_level ?? 'Unknown'}</Badge>} />
          <Grid cols={{ default: 2 }} gap={3}>
            <StatCard label={t('Fast Charges')} value={data?.charging_habits?.fast_charge_count ?? 0} />
            <StatCard label={t('Deep Discharges')} value={data?.charging_habits?.deep_discharge_count ?? 0} />
            <StatCard label={t('Charged to Full')} value={data?.charging_habits?.charge_to_full_count ?? 0} />
            <StatCard label={t('Cell Temp')} value={`${data?.current_temp?.toFixed(1) ?? '0'}°C`} />
          </Grid>
        </Card>
      </Grid>

      <Card>
        <CardHeader title={t('Health Trend & Projection')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>
    </PageContainer>
  );
}
