import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDrivingDynamics } from '@/api/hooks/useDriving';

function gForceLabel(g: number): string {
  if (g < 0.2) return 'Gentle';
  if (g < 0.4) return 'Moderate';
  if (g < 0.6) return 'Firm';
  return 'Aggressive';
}

export default function DrivingDynamicsPage() {
  const { t } = useTranslation();
  const { data: dynamics, isLoading, error } = useDrivingDynamics();

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.subtitle', 'Acceleration, braking, and cornering metrics')}
      loading={isLoading}
      error={error as Error | null}
      empty={!dynamics}
      emptyMessage={t('dynamics.empty', 'No dynamics data available.')}
    >
      {dynamics && (
        <>
          <Grid cols={{ default: 2, md: 3 }} gap={4}>
            <StatCard
              label={t('dynamics.maxAccel', 'Max Acceleration')}
              value={(dynamics.maxAccelerationG ?? 0).toFixed(2)}
              unit="g"
            />
            <StatCard
              label={t('dynamics.maxBraking', 'Max Braking')}
              value={(dynamics.maxBrakingG ?? 0).toFixed(2)}
              unit="g"
            />
            <StatCard
              label={t('dynamics.maxCornering', 'Max Cornering')}
              value={(dynamics.maxCorneringG ?? 0).toFixed(2)}
              unit="g"
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('dynamics.averages', 'Average G-Forces')} />
              <KVList
                items={[
                  {
                    label: t('dynamics.avgAccel', 'Avg Acceleration'),
                    value: `${(dynamics.avgAccelerationG ?? 0).toFixed(2)} g (${gForceLabel(dynamics.avgAccelerationG)})`,
                  },
                  {
                    label: t('dynamics.avgBraking', 'Avg Braking'),
                    value: `${(dynamics.avgBrakingG ?? 0).toFixed(2)} g (${gForceLabel(dynamics.avgBrakingG)})`,
                  },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title={t('dynamics.smoothness', 'Smoothness')} />
              <KVList
                items={[
                  {
                    label: t('dynamics.smoothnessScore', 'Smoothness Score'),
                    value: `${dynamics.smoothnessScore}/100`,
                  },
                  {
                    label: t('dynamics.drivingStyle', 'Driving Style'),
                    value: dynamics.smoothnessScore >= 70
                      ? t('dynamics.smooth', 'Smooth')
                      : dynamics.smoothnessScore >= 40
                        ? t('dynamics.moderate', 'Moderate')
                        : t('dynamics.aggressive', 'Aggressive'),
                  },
                ]}
              />
            </Card>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
