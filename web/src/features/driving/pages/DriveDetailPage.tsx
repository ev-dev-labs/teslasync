import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDrive } from '@/api/hooks/useDriving';

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DriveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { data: drive, isLoading, error } = useDrive(id ?? '');

  return (
    <PageContainer
      title={t('driveDetail.title', 'Drive Detail')}
      subtitle={drive ? `${new Date(drive.startDate).toLocaleDateString()} — ${drive.startAddress ?? '?'} → ${drive.endAddress ?? '?'}` : undefined}
      loading={isLoading}
      error={error as Error | null}
    >
      {drive && (
        <>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard label={t('driveDetail.distance', 'Distance')} value={drive.distance.toFixed(1)} unit="km" />
            <StatCard label={t('driveDetail.duration', 'Duration')} value={formatDuration(drive.durationMin)} />
            <StatCard
              label={t('driveDetail.avgSpeed', 'Avg Speed')}
              value={drive.speedAvg !== null ? Math.round(drive.speedAvg) : '—'}
              unit="km/h"
            />
            <StatCard
              label={t('driveDetail.maxSpeed', 'Max Speed')}
              value={drive.speedMax !== null ? Math.round(drive.speedMax) : '—'}
              unit="km/h"
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('driveDetail.routeInfo', 'Route Info')} />
              <KVList
                items={[
                  { label: t('driveDetail.from', 'From'), value: drive.startAddress ?? '—' },
                  { label: t('driveDetail.to', 'To'), value: drive.endAddress ?? '—' },
                  { label: t('driveDetail.startTime', 'Start Time'), value: new Date(drive.startDate).toLocaleTimeString() },
                  { label: t('driveDetail.endTime', 'End Time'), value: drive.endDate ? new Date(drive.endDate).toLocaleTimeString() : '—' },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title={t('driveDetail.batteryEnergy', 'Battery & Energy')} />
              <KVList
                items={[
                  { label: t('driveDetail.startBattery', 'Start Battery'), value: drive.startBatteryLevel !== null ? `${drive.startBatteryLevel}%` : '—' },
                  { label: t('driveDetail.endBattery', 'End Battery'), value: drive.endBatteryLevel !== null ? `${drive.endBatteryLevel}%` : '—' },
                  { label: t('driveDetail.peakPower', 'Peak Power'), value: drive.powerMax !== null ? `${drive.powerMax} kW` : '—' },
                  { label: t('driveDetail.regenPeak', 'Regen Peak'), value: drive.powerMin !== null ? `${Math.abs(drive.powerMin)} kW` : '—' },
                  { label: t('driveDetail.outsideTemp', 'Outside Temp'), value: drive.outsideTempAvg !== null ? `${drive.outsideTempAvg}°C` : '—' },
                ]}
              />
            </Card>
          </Grid>

          {drive.positions.length > 0 && (
            <Card>
              <CardHeader
                title={t('driveDetail.mapView', 'Route Map')}
                subtitle={t('driveDetail.mapHint', 'Map visualization available in full app')}
              />
              <p className="text-sm text-gray-500">
                {drive.positions.length} {t('driveDetail.positionsRecorded', 'positions recorded')}
              </p>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}
