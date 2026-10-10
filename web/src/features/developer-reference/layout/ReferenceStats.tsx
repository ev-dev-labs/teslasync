import { useTranslation } from 'react-i18next';
import { StatGroup, StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { CardGrid, LayoutCard, Section } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';

export function ReferenceStats() {
  const { t } = useTranslation();
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('developerReference.layout.stats.period', 'Synthetic fixture · no analysis period'),
    reason: t('developerReference.layout.stats.periodReason', 'These readings are invented presentation inputs, not selected-window totals or live vehicle data.'),
  };
  const metrics: StatMetric[] = [
    { metricId: 'distance', rawValue: 14500 },
    { metricId: 'energy', rawValue: 850 },
    { metricId: 'duration', rawValue: 7800 },
    { metricId: 'count', rawValue: 0 },
    { metricId: 'text', rawValue: 'America/Los_Angeles' },
    { metricId: 'power', rawValue: null, missingReason: t('developerReference.layout.stats.missingReason', 'The synthetic source deliberately provides no power reading.') },
  ];
  return (
    <Section id="layout-stats" title={t('developerReference.layout.stats.title', 'Shared stats: values, text, zero and missing')}>
      <StatStrip id="layout-reference-six" metrics={metrics} period={period} />
      <StatStrip
        id="layout-reference-loading"
        title={t('developerReference.layout.stats.loadingTitle', 'Shared stats loading')}
        metrics={metrics}
        period={period}
        loading
      />
      <CardGrid label={t('developerReference.layout.stats.embeddedGrid', 'Embedded shared statistics')} items={[{
        id: 'embedded',
        size: 'full',
        content: <LayoutCard title={t('developerReference.layout.stats.embeddedTitle', 'Same implementation inside a card')}>
          <Text as="p" id="layout-embedded-period" variant="bodySm">{period.label}</Text>
          <StatGroup
            id="layout-reference-embedded"
            metrics={metrics.slice(0, 3)}
            period={period}
            periodInHeader
            periodHeaderId="layout-embedded-period"
          />
        </LayoutCard>,
      }]} />
    </Section>
  );
}
