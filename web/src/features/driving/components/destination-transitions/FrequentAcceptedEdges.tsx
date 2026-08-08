import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { DestinationTransitionEdgeList } from './DestinationTransitionEdgeList';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface FrequentAcceptedEdgesProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function FrequentAcceptedEdges({
  model,
  state,
  locale,
}: FrequentAcceptedEdgesProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="destination-frequent-edges">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.frequent.title',
            'Frequent accepted edges',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.frequent.subtitle',
            'Ranked by accepted count after adjacent-row endpoint continuity and time-order checks.',
          )}
        </Text>
        <DestinationTransitionsSectionBody model={model} state={state}>
          <DestinationTransitionEdgeList
            edges={model.frequentEdges}
            locale={locale}
            mode="frequency"
          />
        </DestinationTransitionsSectionBody>
      </GlassPanel>
    </section>
  );
}
