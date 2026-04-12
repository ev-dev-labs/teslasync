import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useVehicles } from '@/api/hooks/useVehicles';

export default function TemperatureImpactPage() {
  const { t } = useTranslation();
  const { data: vehicles, isLoading, error } = useVehicles();

  const vehicle = vehicles?.[0];

  return (
    <PageContainer
      title={t('Temperature Impact')}
      subtitle="How temperature affects driving efficiency, battery drain, and energy consumption"
      loading={isLoading}
      error={error as Error | null}
      empty={!vehicle}
      emptyMessage="No vehicle data available for temperature analysis."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label="Winter Penalty" value="—" unit="%" />
        <StatCard label="Summer Penalty" value="—" unit="%" />
        <StatCard label="Optimal Efficiency" value="—" unit="%/100km" />
        <StatCard label="Temp Buckets" value={5} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Efficiency vs Temperature" subtitle="Chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Battery %/100km vs temperature area chart
          </div>
        </Card>

        <Card>
          <CardHeader title="Vampire Drain vs Temperature" subtitle="Chart placeholder" />
          <div className="flex h-48 items-center justify-center text-sm text-gray-400">
            Drain rate bar chart by temperature bucket
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Monthly Temperature & Efficiency Trend" subtitle="Chart placeholder" />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Combined bar + line chart — efficiency and avg temperature by month
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Efficiency by Temperature Range" />
        <KVList
          items={[
            { label: 'Below 0°C', value: 'N/A' },
            { label: '0–10°C', value: 'N/A' },
            { label: '10–20°C', value: 'N/A' },
            { label: '20–30°C', value: 'N/A' },
            { label: 'Above 30°C', value: 'N/A' },
          ]}
        />
      </Card>
    </PageContainer>
  );
}
