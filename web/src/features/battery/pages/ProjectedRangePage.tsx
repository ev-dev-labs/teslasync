import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui';
import { useProjectedRange } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function ProjectedRangePage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useProjectedRange(activeId);

  const daysOfRange = data && data.avg_daily_km > 0
    ? Math.round(data.current_range_km / data.avg_daily_km)
    : null;

  return (
    <PageContainer
      title={t('Projected Range')}
      subtitle={t('Range estimation based on degradation and driving patterns')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No range data available yet.')}
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
      <Grid cols={{ default: 2, md: 3, lg: 5 }} gap={4}>
        <StatCard label={t('Current Range')} value={data?.current_range_km?.toFixed(0) ?? '0'} unit="km" />
        <StatCard label={t('When New')} value={data?.new_range_km?.toFixed(0) ?? '0'} unit="km" />
        <StatCard
          label={t('Degradation')}
          value={`${data?.degradation_pct?.toFixed(1) ?? '0'}%`}
          trend={data ? { direction: 'down', value: `${data.total_cycles} cycles`, positive: false } : undefined}
        />
        <StatCard label={t('Health Score')} value={`${data?.health_score ?? 0}/100`} />
        <StatCard
          label={t('Days of Range')}
          value={daysOfRange != null ? String(daysOfRange) : '–'}
          trend={data && data.avg_daily_km > 0
            ? { direction: 'flat', value: `${data.avg_daily_km.toFixed(0)} km/day avg` }
            : undefined
          }
        />
      </Grid>

      <Card>
        <CardHeader title={t('Historical Range Trend')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>

      <Card>
        <CardHeader title={t('Temperature Impact on Range')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>

      <Card>
        <CardHeader title={t('12-Month Range Projection')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>
    </PageContainer>
  );
}
