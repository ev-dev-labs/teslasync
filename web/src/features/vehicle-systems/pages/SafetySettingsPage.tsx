import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useSafety } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function SafetySettingsPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data, isLoading, error } = useSafety(String(activeId));

  const safetyScore = useMemo(() => {
    if (!data) return 0;
    const checks = [
      data.automaticEmergencyBraking,
      data.blindSpotCamera,
      data.blindSpotWarning,
      data.emergencyLaneDeparture,
      data.pinToDriveEnabled,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [data]);

  const scoreVariant = safetyScore >= 80 ? 'success' : safetyScore >= 50 ? 'warning' : 'danger';

  return (
    <PageContainer
      title={t('Safety Settings')}
      subtitle={t('ADAS features, safety score, and driving stats')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No safety data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={String(activeId)}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Safety Score')} value={`${safetyScore}%`} />
        <StatCard label={t('Cruise Distance')} value={data?.cruiseFollowDistance ?? 0} />
        <StatCard label={t('Miles Since Reset')} value={data?.milesSinceReset?.toFixed(0) ?? '0'} />
        <StatCard label={t('Self-Driving Miles')} value={data?.selfDrivingMilesSinceReset?.toFixed(0) ?? '0'} />
      </Grid>

      <Card>
        <CardHeader
          title={t('ADAS Features')}
          action={<Badge variant={scoreVariant}>{safetyScore}%</Badge>}
        />
        <KVList
          columns={2}
          items={[
            { label: t('AEB'), value: <Badge variant={data?.automaticEmergencyBraking ? 'success' : 'danger'}>{data?.automaticEmergencyBraking ? t('On') : t('Off')}</Badge> },
            { label: t('Blind Spot Camera'), value: <Badge variant={data?.blindSpotCamera ? 'success' : 'danger'}>{data?.blindSpotCamera ? t('On') : t('Off')}</Badge> },
            { label: t('Blind Spot Warning'), value: <Badge variant={data?.blindSpotWarning ? 'success' : 'danger'}>{data?.blindSpotWarning ? t('On') : t('Off')}</Badge> },
            { label: t('Forward Collision'), value: data?.forwardCollisionWarning ?? '--' },
            { label: t('Lane Departure'), value: data?.laneDepartureAvoidance ?? '--' },
            { label: t('Emergency Lane Departure'), value: <Badge variant={data?.emergencyLaneDeparture ? 'success' : 'danger'}>{data?.emergencyLaneDeparture ? t('On') : t('Off')}</Badge> },
            { label: t('Speed Limit Warning'), value: data?.speedLimitWarning ?? '--' },
            { label: t('PIN to Drive'), value: <Badge variant={data?.pinToDriveEnabled ? 'success' : 'danger'}>{data?.pinToDriveEnabled ? t('On') : t('Off')}</Badge> },
          ]}
        />
      </Card>
    </PageContainer>
  );
}
