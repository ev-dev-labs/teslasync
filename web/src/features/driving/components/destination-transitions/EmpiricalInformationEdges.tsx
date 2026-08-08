import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { DestinationTransitionEdgeList } from './DestinationTransitionEdgeList';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface EmpiricalInformationEdgesProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function EmpiricalInformationEdges({
  model,
  state,
  locale,
}: EmpiricalInformationEdgesProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="destination-information-edges">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Binary className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.information.title',
            'Empirically rare accepted edges',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.information.subtitle',
            'Higher information content means a smaller observed share among that origin’s accepted outgoing transitions.',
          )}
        </Text>
        <DestinationTransitionsSectionBody model={model} state={state}>
          <DestinationTransitionEdgeList
            edges={model.empiricallyRareEdges}
            locale={locale}
            mode="information"
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'destinationTransitions.information.caveat',
                'Empirical information content equals −log₂(observed origin share). It describes in-sample rarity only and is not evidence of unusual future behavior.',
              )}
            </Text>
          </AlertBanner>
        </DestinationTransitionsSectionBody>
      </GlassPanel>
    </section>
  );
}
