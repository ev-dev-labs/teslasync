import { useTranslation } from 'react-i18next';
import { CardGrid, KeyValueList, LayoutCard, Section } from '@/components/layout/layout-reference';

export function ReferenceLists() {
  const { t } = useTranslation();
  const facts = [
    { id: 'source', label: t('developerReference.layout.facts.source', 'Source'), value: t('developerReference.layout.facts.synthetic', 'Synthetic reference') },
    { id: 'timezone', label: t('developerReference.layout.facts.timezone', 'Timezone'), value: 'America/Los_Angeles' },
    { id: 'period', label: t('developerReference.layout.facts.period', 'Analysis period'), value: t('developerReference.layout.facts.unknown', 'Unknown') },
    { id: 'access', label: t('developerReference.layout.facts.access', 'Access'), value: t('developerReference.layout.facts.reviewOnly', 'Developer review only') },
    { id: 'precision', label: t('developerReference.layout.facts.precision', 'Number preferences'), value: t('developerReference.layout.facts.preserved', 'Existing preferences preserved') },
    { id: 'availability', label: t('developerReference.layout.facts.availability', 'Availability'), value: t('developerReference.layout.facts.independent', 'Independent per source') },
    { id: 'order', label: t('developerReference.layout.facts.order', 'Reading order'), value: t('developerReference.layout.facts.sourceOrder', 'Source order retained') },
    { id: 'runtime', label: t('developerReference.layout.facts.runtime', 'Runtime acceptance'), value: t('developerReference.layout.facts.notRun', 'Not run') },
    { id: 'missing', label: t('developerReference.layout.facts.missing', 'Missing source fact'), value: null, missingReason: t('developerReference.layout.facts.missingReason', 'This fixture intentionally omits the fact.') },
  ];
  return (
    <Section id="layout-lists" title={t('developerReference.layout.lists.title', 'List pairs and nine diagnostic facts')}>
      <CardGrid label={t('developerReference.layout.lists.grid', 'Paired diagnostic lists')} items={[
        { id: 'facts-a', size: 'half', content: <LayoutCard title={t('developerReference.layout.lists.firstTitle', 'Diagnostic facts with a long timezone value')}><KeyValueList items={facts} /></LayoutCard> },
        { id: 'facts-b', size: 'half', content: <LayoutCard title={t('developerReference.layout.lists.secondTitle', 'Matching list with every fact reachable')}><KeyValueList items={facts} /></LayoutCard> },
      ]} />
    </Section>
  );
}
