import { useTranslation } from 'react-i18next';
import { CardGrid, Section } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';
import { ReferenceDailyChart } from './ReferenceDailyChart';

export function ReferenceCharts() {
  const { t } = useTranslation();
  return (
    <Section
      id="layout-charts"
      title={t('developerReference.layout.chart.sectionTitle', 'Paired charts and dense daily series')}
      description={t('developerReference.layout.chart.sectionDescription', 'Matching plot heights come from the grid container, including inside a narrow panel.')}
    >
      <CardGrid label={t('developerReference.layout.chart.pairedGrid', 'Paired synthetic charts')} items={[
        { id: 'chart-a', size: 'half', content: <ReferenceDailyChart title={t('developerReference.layout.chart.firstTitle', 'Daily synthetic observations')} /> },
        { id: 'chart-b', size: 'half', content: <ReferenceDailyChart title={t('developerReference.layout.chart.secondTitle', 'The same fixture in a paired plot')} /> },
        { id: 'chart-empty', size: 'half', content: <ReferenceDailyChart title={t('developerReference.layout.chart.emptyTitle', 'Empty synthetic chart · orphan expands')} empty /> },
      ]} />
      <Text as="p" variant="bodySm" className="text-center">
        {t('developerReference.layout.chart.legend', 'Legend: Synthetic sample · August–September 2026 (UTC)')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('developerReference.layout.chart.sampling', 'Narrow plots select evenly spaced fixture observations for display only. All 60 observations remain in each chart’s accessible data table; tick labels are thinned separately.')}
      </Text>
    </Section>
  );
}
