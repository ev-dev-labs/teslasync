import { useTranslation } from 'react-i18next';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { glossary } from '@/lib/metric-reference';

export function ReferenceGlossary() {
  const { t } = useTranslation();
  return <GlassPanel className="space-y-3 p-4">
    <Heading>{t('developerReference.stats.glossary.title', 'Chosen candidate glossary')}</Heading>
    <Text as="p">{t('developerReference.stats.glossary.policy',
      'Quantity IDs do not prove page semantics. Source occurrence IDs are not semantic IDs. Unreviewed production mappings remain UNKNOWN; recorded cost, estimates, charging rate and mean session power stay distinct.')}</Text>
    <dl className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      {Object.entries(glossary).map(([id, definition]) => <div key={id} className="min-w-0 [overflow-wrap:anywhere]">
        <dt className="font-medium">{t(`developerReference.stats.metric.${id}.label`, definition.label)}</dt>
        <dd className="text-sm text-[var(--text-secondary)]">
          {t(`developerReference.stats.metric.${id}.description`, definition.description)}
          <Text as="p" mono>{id} · {definition.inputUnit}</Text>
        </dd>
      </div>)}
    </dl>
  </GlassPanel>;
}
