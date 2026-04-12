import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { useTimeline, useStateSummary } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { TimelineEvent, StateSummary } from '@/types/analytics';

const STATE_VARIANTS: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  driving: 'info',
  charging: 'success',
  asleep: 'warning',
  online: 'info',
  offline: 'danger',
};

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function TimelinePage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const vehicleId = vehicles?.[0]?.id ?? '';

  const { data: events, isLoading, error } = useTimeline(vehicleId);
  const { data: summary } = useStateSummary(vehicleId);

  const totalMin = summary?.reduce((s: number, e: StateSummary) => s + e.totalMin, 0) ?? 0;
  const drivingMin = summary?.find((s: StateSummary) => s.state === 'driving')?.totalMin ?? 0;
  const chargingMin = summary?.find((s: StateSummary) => s.state === 'charging')?.totalMin ?? 0;

  return (
    <PageContainer
      title={t('Timeline')}
      subtitle="Vehicle state history — driving, charging, sleeping, online"
      loading={isLoading}
      error={error as Error | null}
      empty={events?.length === 0}
      emptyMessage="No timeline data available."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label="Total Tracked" value={formatDuration(totalMin)} />
        <StatCard label="Driving" value={formatDuration(drivingMin)} />
        <StatCard label="Charging" value={formatDuration(chargingMin)} />
        <StatCard label="State Changes" value={events?.length ?? 0} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Time Distribution" subtitle="Pie chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            State distribution pie chart
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Daily State Breakdown" subtitle="Chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Daily stacked bar chart
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent State Changes" />
        {events && events.length > 0 ? (
          <div className="space-y-2">
            {events.slice(0, 30).map((event: TimelineEvent) => (
              <div
                key={event.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 dark:border-gray-700"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={STATE_VARIANTS[event.state] ?? 'info'}>
                    {event.state}
                  </Badge>
                  <span className="text-sm">{formatDuration(event.durationMin)}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(event.startDate).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">No state history</p>
        )}
      </Card>
    </PageContainer>
  );
}
