import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { PackAutomationRecommendation } from '../lib/manifestTypes';

export function PackRecommendations({ recommendations }: { recommendations: readonly PackAutomationRecommendation[] }) {
  const { t } = useTranslation();
  if (recommendations.length === 0) return null;

  return (
    <section aria-label={t('intelPacks.detail.recommendations', 'Automation recommendations')}>
      <Text variant="bodySm" className="font-semibold mb-1">
        {t('intelPacks.detail.recommendations', 'Automation recommendations')}
      </Text>
      <div className="space-y-4">
        {recommendations.map((recommendation) => (
          <div key={recommendation.id} className="space-y-2">
            <Text as="p" variant="bodySm">{recommendation.title}</Text>
            <KVList layout="responsive" wrap items={[
              { id: recommendation.id + ':rationale', label: t('intelPacks.detail.recommendationRationale', 'Rationale'), value: recommendation.rationale },
              { id: recommendation.id + ':trigger', label: t('intelPacks.detail.recommendationTrigger', 'Suggested trigger'), value: recommendation.suggestedTriggerSummary },
              { id: recommendation.id + ':condition', label: t('intelPacks.detail.recommendationCondition', 'Suggested condition'), value: recommendation.suggestedConditionSummary },
              { id: recommendation.id + ':action', label: t('intelPacks.detail.recommendationAction', 'Suggested action'), value: recommendation.suggestedActionSummary },
            ]} />
          </div>
        ))}
      </div>
    </section>
  );
}
