import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { JourneyFragmentationSectionProps } from './_types';

export function PendingEvidence({ state, loading = false }: Pick<JourneyFragmentationSectionProps, 'state' | 'loading'>) {
  const { t } = useTranslation();
  return (
    <div aria-busy={loading || undefined} className="space-y-3">
      <Text as="p" variant="caption">
        {state?.isRefreshBlocked && !state.fatalError
          ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
          : t('driving.brief.pending', 'Drive evidence is not available yet.')}
      </Text>
      {loading && <Skeleton lines={2} />}
    </div>
  );
}
