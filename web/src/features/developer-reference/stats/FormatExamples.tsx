import { useTranslation } from 'react-i18next';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { formatMetric, glossary, type MetricPreferences } from '@/lib/metric-reference';
import { formatFixtures } from './fixtures';

export function FormatExamples({ preferences }: { preferences: MetricPreferences }) {
  const { t } = useTranslation();
  return <GlassPanel className="space-y-4 p-4">
    <Heading>{t('developerReference.stats.examples.title', 'Original examples and canonical boundaries')}</Heading>
    <Text as="p">{t('developerReference.stats.examples.policy',
      'Synthetic values. Original specification examples remain visible for review; candidate output preserves selected precision and units instead of forcing adaptive formats or humanized durations.')}</Text>
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      {formatFixtures.map(fixture => {
        const prefs = { ...preferences, units: { ...preferences.units, ...fixture.units } };
        const result = formatMetric(fixture.metricId, fixture.rawValue, prefs);
        const definition = glossary[fixture.metricId];
        const reason = result.reasonKey ? t(result.reasonKey, result.reason ?? '') : result.reason;
        return <article key={fixture.id} data-format-fixture={fixture.id}
          className="min-w-0 space-y-1 rounded-lg border border-[var(--border-default)] p-3 [overflow-wrap:anywhere]">
          <Heading level="sub">{t(`developerReference.stats.metric.${fixture.metricId}.label`, definition.label)}</Heading>
          <Text as="p">{t('developerReference.stats.examples.original', 'Original example: {{example}}',
            { example: t(`developerReference.stats.fixture.${fixture.id}`, fixture.originalExample) })}</Text>
          <Text as="p" className="font-semibold">{t('developerReference.stats.examples.output', 'Candidate output: {{output}}', { output: result.text })}</Text>
          <Text as="p" variant="caption">{t('developerReference.stats.examples.raw', 'Canonical input: {{raw}} {{unit}}',
            { raw: Object.is(fixture.rawValue, -0) ? '-0' : String(fixture.rawValue), unit: definition.inputUnit })}</Text>
          <Text as="p" variant="caption">{t('developerReference.stats.examples.state', 'State: {{state}}',
            { state: t(`developerReference.stats.valueState.${result.state}`, result.state) })}</Text>
          {reason && <Text as="p" variant="caption">{reason}</Text>}
        </article>;
      })}
    </div>
  </GlassPanel>;
}
