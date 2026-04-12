import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import type { Drive } from '@/types/driving';

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function efficiencyGrade(drive: Drive): { label: string; variant: 'success' | 'info' | 'warning' | 'danger' } {
  const battUsed = (drive.startBatteryLevel ?? 0) - (drive.endBatteryLevel ?? 0);
  if (drive.distance <= 0 || battUsed <= 0) return { label: '—', variant: 'neutral' as 'info' };
  const whKm = (battUsed * 0.75 * 1000) / drive.distance;
  if (whKm < 150) return { label: 'A', variant: 'success' };
  if (whKm < 200) return { label: 'B', variant: 'info' };
  if (whKm < 250) return { label: 'C', variant: 'warning' };
  return { label: 'D', variant: 'danger' };
}

function DriveRow({ drive }: { drive: Drive }) {
  const grade = efficiencyGrade(drive);
  return (
    <Link to={`/drives/${drive.id}`}>
      <Card hover className="flex items-center justify-between">
        <div>
          <p className="font-medium">{new Date(drive.startDate).toLocaleDateString()}</p>
          <p className="text-xs text-gray-500">
            {drive.startAddress ?? '—'} → {drive.endAddress ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right">
            <p className="font-medium">{drive.distance.toFixed(1)} km</p>
            <p className="text-xs text-gray-500">{formatDuration(drive.durationMin)}</p>
          </div>
          {drive.speedAvg !== null && (
            <p className="text-xs text-gray-500">Avg {Math.round(drive.speedAvg)} km/h</p>
          )}
          <Badge variant={grade.variant}>{grade.label}</Badge>
        </div>
      </Card>
    </Link>
  );
}

export default function DrivesListPage() {
  const { t } = useTranslation();
  const { data: drives, isLoading, error } = useDrives();
  const { data: stats } = useDrivingStats();

  return (
    <PageContainer
      title={t('drives.title', 'Drive History')}
      subtitle={t('drives.subtitle', 'Trip scoring, efficiency, and performance data')}
      loading={isLoading}
      error={error as Error | null}
      empty={drives?.length === 0}
      emptyMessage={t('drives.empty', 'No drives recorded yet.')}
    >
      {stats && (
        <Grid cols={{ default: 2, md: 4 }} gap={4}>
          <StatCard label={t('drives.totalDrives', 'Total Drives')} value={stats.totalDrives} />
          <StatCard label={t('drives.totalDistance', 'Total Distance')} value={Math.round(stats.totalDistanceKm)} unit="km" />
          <StatCard label={t('drives.avgEfficiency', 'Avg Efficiency')} value={Math.round(stats.avgEfficiencyWhKm)} unit="Wh/km" />
          <StatCard label={t('drives.topSpeed', 'Top Speed')} value={Math.round(stats.topSpeedKmh)} unit="km/h" />
        </Grid>
      )}

      <div className="space-y-3">
        {drives?.map((d) => <DriveRow key={d.id} drive={d} />)}
      </div>
    </PageContainer>
  );
}
