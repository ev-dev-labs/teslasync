import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { KVList } from '@/components/data-display/KVList';
import { useVampireDrainStats, useVampireDrainEvents } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function VampireDrainPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data: stats, isLoading, error } = useVampireDrainStats(activeId != null ? String(activeId) : null);
  const { data: events } = useVampireDrainEvents(activeId != null ? String(activeId) : null);

  return (
    <PageContainer
      title={t('Vampire Drain')}
      subtitle={t('Analyze energy loss while your vehicle is parked')}
      loading={isLoading}
      error={error as Error | null}
      empty={!stats}
      emptyMessage={t('No vampire drain data recorded yet.')}
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
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Avg Drain Rate')} value={`${stats?.avg_drain_rate?.toFixed(2) ?? '0'}%/hr`} />
        <StatCard label={t('Total Range Lost')} value={stats?.total_range_lost?.toFixed(0) ?? '0'} unit="km" />
        <StatCard label={t('Total Idle Hours')} value={`${stats?.total_hours?.toFixed(0) ?? '0'} hrs`} />
        <StatCard label={t('Events')} value={stats?.event_count ?? 0} />
      </Grid>

      {stats && (stats.avg_sentry_drain > 0 || stats.avg_nosentry_drain > 0) && (
        <Grid cols={{ default: 1, md: 2 }} gap={4}>
          <StatCard
            label={t('Sentry Mode ON')}
            value={`${(stats.avg_sentry_drain ?? 0).toFixed(2)}%/hr`}
            icon={<Badge variant="danger" size="sm">{t('Higher drain')}</Badge>}
          />
          <StatCard
            label={t('Sentry Mode OFF')}
            value={`${(stats.avg_nosentry_drain ?? 0).toFixed(2)}%/hr`}
            icon={<Badge variant="success" size="sm">{t('Lower drain')}</Badge>}
          />
        </Grid>
      )}

      <Card>
        <CardHeader title={t('Drain Rate Over Time')} />
        {/* TODO: wrap in ChartContainer */}
      </Card>

      {events && events.length > 0 && (
        <Card>
          <CardHeader title={t('Recent Events')} subtitle={`${events.length} ${t('events')}`} />
          <div className="max-h-96 overflow-y-auto">
            <KVList
              items={events.slice(0, 20).map((e) => ({
                label: e.start_date ? new Date(e.start_date).toLocaleDateString() : '—',
                value: `${e.battery_lost}% lost · ${(e.drain_rate_pct_per_hour ?? 0).toFixed(2)}%/hr · ${(e.duration_hours ?? 0).toFixed(1)}h${e.sentry_mode ? ' · Sentry' : ''}`,
              }))}
            />
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
