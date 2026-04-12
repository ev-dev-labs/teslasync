import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDrivetrainHealth } from '@/api/hooks/useDriving';

function healthVariant(health: 'good' | 'warning' | 'critical'): 'success' | 'warning' | 'danger' {
  if (health === 'good') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

function healthLabel(health: 'good' | 'warning' | 'critical'): string {
  if (health === 'good') return 'Healthy';
  if (health === 'warning') return 'Warm';
  return 'Hot';
}

function formatTemp(celsius: number | null): string {
  return celsius !== null ? `${celsius}°C` : '—';
}

export default function DrivetrainHealthPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDrivetrainHealth();

  return (
    <PageContainer
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('drivetrain.empty', 'No drivetrain data available.')}
    >
      {data && (
        <>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard
              label={t('drivetrain.frontMotor', 'Front Motor')}
              value={formatTemp(data.frontMotorTempC)}
            />
            <StatCard
              label={t('drivetrain.rearMotor', 'Rear Motor')}
              value={formatTemp(data.rearMotorTempC)}
            />
            <StatCard
              label={t('drivetrain.inverter', 'Inverter')}
              value={formatTemp(data.inverterTempC)}
            />
            <StatCard
              label={t('drivetrain.battery', 'Battery')}
              value={formatTemp(data.batteryTempC)}
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('drivetrain.status', 'Overall Status')} />
              <div className="flex items-center gap-4">
                <Badge variant={healthVariant(data.overallHealth)} size="lg">
                  {healthLabel(data.overallHealth)}
                </Badge>
                <p className="text-sm text-gray-500">
                  {t('drivetrain.motorState', 'Motor State')}: {data.motorStatus}
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader title={t('drivetrain.temperatures', 'Temperature Details')} />
              <KVList
                items={[
                  { label: t('drivetrain.frontMotorTemp', 'Front Motor Temp'), value: formatTemp(data.frontMotorTempC) },
                  { label: t('drivetrain.rearMotorTemp', 'Rear Motor Temp'), value: formatTemp(data.rearMotorTempC) },
                  { label: t('drivetrain.inverterTemp', 'Inverter Temp'), value: formatTemp(data.inverterTempC) },
                  { label: t('drivetrain.batteryTemp', 'Battery Temp'), value: formatTemp(data.batteryTempC) },
                ]}
              />
            </Card>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
