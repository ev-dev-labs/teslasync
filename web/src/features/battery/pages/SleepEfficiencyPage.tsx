import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { KVList } from '@/components/data-display/KVList';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useSleepEfficiency(activeId, days);

  return (
    <PageContainer
      title={t('Sleep Efficiency')}
      subtitle={t('Vehicle sleep patterns, vampire drain and sentry mode costs')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No sleep data available. Data will appear after sleep/wake events.')}
      actions={
        <div className="flex items-center gap-2">
          <Select
            options={[
              { value: '7', label: `7 ${t('days')}` },
              { value: '30', label: `30 ${t('days')}` },
              { value: '90', label: `90 ${t('days')}` },
              { value: '180', label: `180 ${t('days')}` },
            ]}
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          {vehicles && vehicles.length > 1 && (
            <Select
              options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin }))}
              value={String(activeId ?? '')}
              onChange={(e) => setVehicleId(e.target.value)}
            />
          )}
        </div>
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Sleep Efficiency')} value={`${data?.sleep_efficiency_pct?.toFixed(1) ?? '0'}%`} />
        <StatCard label={t('Avg Time to Sleep')} value={`${data?.time_to_sleep_avg_min?.toFixed(0) ?? '0'} min`} />
        <StatCard
          label={t('Sentry Drain Rate')}
          value={`${data?.sentry_on_drain_rate?.toFixed(2) ?? '0'}%/hr`}
          trend={{ direction: 'down', value: `vs ${data?.sentry_off_drain_rate?.toFixed(2) ?? '0'}%/hr without`, positive: false }}
        />
        <StatCard label={t('Sentry Monthly Cost')} value={`$${data?.sentry_monthly_cost?.toFixed(2) ?? '0'}`} />
      </Grid>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('State Distribution')} />
          {/* TODO: wrap in ChartContainer */}
          {data?.state_distribution && data.state_distribution.length > 0 && (
            <KVList
              items={data.state_distribution.map((s) => ({
                label: s.state,
                value: `${(s.total_minutes / 60).toFixed(1)} hrs`,
              }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader title={t('Sentry Mode Impact')} />
          <Grid cols={{ default: 3 }} gap={2}>
            <div className="text-center">
              <p className="text-lg font-bold">{data?.sentry_extra_drain_rate?.toFixed(2) ?? '0'}%</p>
              <p className="text-xs text-gray-500">{t('Extra drain/hr')}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{data?.sentry_extra_monthly_kwh?.toFixed(1) ?? '0'} kWh</p>
              <p className="text-xs text-gray-500">{t('Extra monthly')}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">${data?.sentry_extra_monthly_cost?.toFixed(2) ?? '0'}</p>
              <p className="text-xs text-gray-500">{t('Extra cost/mo')}</p>
            </div>
          </Grid>
        </Card>
      </Grid>

      {data?.recent_events && data.recent_events.length > 0 && (
        <Card>
          <CardHeader
            title={t('Recent Drain Events')}
            action={<Badge variant="neutral">{data.recent_events.length} {t('events')}</Badge>}
          />
          <div className="max-h-96 overflow-y-auto">
            <KVList
              items={data.recent_events.slice(0, 20).map((e) => ({
                label: e.start_date ? new Date(e.start_date).toLocaleDateString() : '—',
                value: `${(e.battery_lost ?? 0).toFixed(1)}% lost · ${(e.drain_rate ?? 0).toFixed(2)}%/hr · ${(e.duration_hours ?? 0).toFixed(1)}h${e.sentry_mode ? ' · Sentry' : ''}`,
              }))}
            />
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
