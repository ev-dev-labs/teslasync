import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { DestinationTransitionsKpiCards } from './DestinationTransitionsKpiCards';
import { DestinationTransitionsQueryStatus } from './DestinationTransitionsQueryStatus';
import type { DestinationTransitionsQueryState } from './types';

interface DestinationTransitionsKpiBandProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function DestinationTransitionsKpiBand({
  model,
  state,
  locale,
}: DestinationTransitionsKpiBandProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t(
        'destinationTransitions.kpis.aria',
        'Destination transition evidence summary',
      )}
      data-testid="destination-transitions-kpis"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.kpis.title',
            'Continuity-safe destination evidence',
          )}
        </PanelTitle>
        <DestinationTransitionsKpiCards
          model={model}
          state={state}
          locale={locale}
        />
        <DestinationTransitionsQueryStatus model={model} state={state} />
      </GlassPanel>
    </section>
  );
}
