import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDriveScore } from '@/api/hooks/useDriving';

function gradeVariant(grade: string): 'success' | 'info' | 'warning' | 'danger' {
  if (grade === 'A+' || grade === 'A') return 'success';
  if (grade === 'B') return 'info';
  if (grade === 'C') return 'warning';
  return 'danger';
}

function trendArrow(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '↑ Improving';
  if (trend === 'down') return '↓ Declining';
  return '— Stable';
}

export default function DriveScorePage() {
  const { t } = useTranslation();
  const { data: score, isLoading, error } = useDriveScore();

  return (
    <PageContainer
      title={t('driveScore.title', 'Drive Score')}
      subtitle={t('driveScore.subtitle', 'Your driving rating and breakdown')}
      loading={isLoading}
      error={error as Error | null}
      empty={!score}
      emptyMessage={t('driveScore.empty', 'Not enough drives to calculate a score.')}
    >
      {score && (
        <>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard
              label={t('driveScore.overall', 'Overall Score')}
              value={score.overall}
              unit="/100"
            />
            <StatCard
              label={t('driveScore.efficiency', 'Efficiency')}
              value={score.efficiency}
              unit="/40"
            />
            <StatCard
              label={t('driveScore.smoothness', 'Smoothness')}
              value={score.smoothness}
              unit="/30"
            />
            <StatCard
              label={t('driveScore.speedDiscipline', 'Speed Discipline')}
              value={score.speedDiscipline}
              unit="/30"
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('driveScore.gradeTitle', 'Grade')} />
              <div className="flex items-center gap-4">
                <Badge variant={gradeVariant(score.grade)} size="lg">
                  {score.grade}
                </Badge>
                <div>
                  <p className="text-sm font-medium">{trendArrow(score.trend)}</p>
                  <p className="text-xs text-gray-500">
                    {t('driveScore.basedOn', 'Based on {{count}} drives', { count: score.totalDrives })}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title={t('driveScore.breakdown', 'Score Breakdown')} />
              <KVList
                items={[
                  { label: t('driveScore.efficiencyLabel', 'Efficiency (Wh/km)'), value: `${score.efficiency}/40` },
                  { label: t('driveScore.smoothnessLabel', 'Smoothness (power range)'), value: `${score.smoothness}/30` },
                  { label: t('driveScore.speedLabel', 'Speed Discipline'), value: `${score.speedDiscipline}/30` },
                  { label: t('driveScore.totalLabel', 'Total'), value: `${score.overall}/100` },
                ]}
              />
            </Card>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
