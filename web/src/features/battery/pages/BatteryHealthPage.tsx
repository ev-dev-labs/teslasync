import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { useBatteryHealth } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

function healthBadge(score: number): { variant: 'success' | 'warning' | 'danger'; label: string } {
  if (score >= 90) return { variant: 'success', label: 'Excellent' };
  if (score >= 80) return { variant: 'warning', label: 'Good' };
  return { variant: 'danger', label: 'Degraded' };
}

export default function BatteryHealthPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useBatteryHealth(activeId != null ? String(activeId) : null);

  const badge = healthBadge(data?.health_score ?? 0);

  return (
    <PageContainer
      title={t('Battery Health')}
      subtitle={t('Health metrics, degradation and capacity analysis')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No battery health data available yet.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Card>
        <CardHeader
          title={t('Health Score')}
          action={<Badge variant={badge.variant}>{t(badge.label)}</Badge>}
        />
        <p className="text-5xl font-bold text-center py-4">{data?.health_score ?? 0}<span className="text-lg text-gray-500">/100</span></p>
      </Card>

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Degradation')} value={`${data?.degradation_pct?.toFixed(1) ?? '0'}%`} />
        <StatCard label={t('Capacity')} value={`${data?.current_capacity_pct?.toFixed(1) ?? '0'}%`} />
        <StatCard label={t('Cycle Count')} value={data?.total_cycles ?? 0} />
        <StatCard
          label={t('Current Range')}
          value={data?.estimated_range_current_km?.toFixed(0) ?? '0'}
          unit="km"
        />
      </Grid>

      <Card>
        <CardHeader title={t('Capacity Trend')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>
    </PageContainer>
  );
}
