import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { useSpeedProfile } from '@/api/hooks/useDriving';
import type { SpeedBucket } from '@/types/driving';

function BucketBar({ bucket, maxPct }: { bucket: SpeedBucket; maxPct: number }) {
  const widthPct = maxPct > 0 ? (bucket.percentage / maxPct) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-sm text-gray-500 shrink-0">{bucket.range}</span>
      <div className="flex-1 h-5 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded bg-blue-500 dark:bg-blue-400 transition-all"
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="w-16 text-right text-sm font-medium">{(bucket.percentage ?? 0).toFixed(1)}%</span>
      <span className="w-12 text-right text-xs text-gray-500">{bucket.driveCount}</span>
    </div>
  );
}

export default function SpeedProfilePage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useSpeedProfile();

  const maxPct = data ? Math.max(...(data.distribution ?? []).map((b) => b.percentage), 1) : 1;

  return (
    <PageContainer
      title={t('speedProfile.title', 'Speed Profile')}
      subtitle={t('speedProfile.subtitle', 'Speed distribution and analysis')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('speedProfile.empty', 'No speed data available.')}
    >
      {data && (
        <>
          <Grid cols={{ default: 2, md: 3 }} gap={4}>
            <StatCard
              label={t('speedProfile.avgSpeed', 'Avg Speed')}
              value={Math.round(data.avgSpeedKmh)}
              unit="km/h"
            />
            <StatCard
              label={t('speedProfile.peakSpeed', 'Peak Speed')}
              value={Math.round(data.peakSpeedKmh)}
              unit="km/h"
            />
            <StatCard
              label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
              value={Math.round(data.optimalSpeedKmh)}
              unit="km/h"
            />
          </Grid>

          <Card>
            <CardHeader
              title={t('speedProfile.distribution', 'Speed Distribution')}
              subtitle={t('speedProfile.distributionHint', 'Time spent in each speed range')}
            />
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs text-gray-400 font-medium">
                <span className="w-24">Range</span>
                <span className="flex-1">Percentage</span>
                <span className="w-16 text-right">%</span>
                <span className="w-12 text-right">Drives</span>
              </div>
              {(data.distribution ?? []).map((bucket) => (
                <BucketBar key={bucket.range} bucket={bucket} maxPct={maxPct} />
              ))}
            </div>
          </Card>

          {data.optimalSpeedKmh > 0 && (
            <Card>
              <CardHeader title={t('speedProfile.insight', 'Efficiency Insight')} />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t('speedProfile.insightText', 'Drives around {{speed}} km/h show the best efficiency. Reducing highway speed could improve efficiency by ~15%.', {
                  speed: Math.round(data.optimalSpeedKmh),
                })}
              </p>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}
