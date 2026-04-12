import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useRegenEfficiency } from '@/api/hooks/useDriving';

export default function RegenEfficiencyPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useRegenEfficiency();

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t('regen.subtitle', 'Regen energy recovery and efficiency')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('regen.empty', 'No regen data available.')}
    >
      {data && (
        <>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <StatCard
              label={t('regen.totalRegen', 'Total Regen')}
              value={data.totalRegenKwh.toFixed(1)}
              unit="kWh"
            />
            <StatCard
              label={t('regen.regenRatio', 'Regen Ratio')}
              value={`${data.regenRatio.toFixed(1)}%`}
            />
            <StatCard
              label={t('regen.monthlyAvg', 'Monthly Avg')}
              value={data.monthlyAvgKw.toFixed(1)}
              unit="kW"
            />
            <StatCard
              label={t('regen.freeCharges', 'Free Charges')}
              value={data.freeCharges.toFixed(1)}
            />
          </Grid>

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <Card>
              <CardHeader title={t('regen.recoveryInsight', 'Recovery Insight')} />
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                {t('regen.insightText', "You've recovered {{kwh}} kWh through regenerative braking — equivalent to ~{{charges}} free charges.", {
                  kwh: data.totalRegenKwh.toFixed(1),
                  charges: data.freeCharges.toFixed(1),
                })}
              </p>
              <KVList
                items={[
                  { label: t('regen.lifetimeRegen', 'Lifetime Regen'), value: `${data.totalRegenKwh.toFixed(1)} kWh` },
                  { label: t('regen.recoveryRate', 'Recovery Rate'), value: `${data.regenRatio.toFixed(1)}%` },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title={t('regen.summary', 'Summary')} />
              <KVList
                items={[
                  { label: t('regen.avgRegenPower', 'Avg Regen Power'), value: `${data.monthlyAvgKw.toFixed(1)} kW` },
                  { label: t('regen.equivCharges', 'Equiv. Free Charges'), value: data.freeCharges.toFixed(1) },
                  { label: t('regen.ratioLabel', 'Regen Ratio'), value: `${data.regenRatio.toFixed(1)}%` },
                  { label: t('regen.totalRecovered', 'Total Recovered'), value: `${data.totalRegenKwh.toFixed(1)} kWh` },
                ]}
              />
            </Card>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
