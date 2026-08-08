import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import type { RegenEfficiencyData } from '@/types/driving';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { AggregateRecoveryEvidence } from './AggregateRecoveryEvidence';
import { DetailScopeNotice } from './DetailScopeNotice';
import { DetailedRecoveryEvidence } from './DetailedRecoveryEvidence';
import type { RegenSectionState } from './types';

interface RecoveryOverviewProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
}

export function RecoveryOverview({
  aggregate,
  model,
  aggregateState,
  detailState,
}: RecoveryOverviewProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('regen.overview.aria', 'Aggregate and detailed recovery overview')}
      data-testid="regen-overview"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('regen.overview.title', 'Recovery overview')}
        </PanelTitle>
        <div className="grid gap-5 xl:grid-cols-2">
          <AggregateRecoveryEvidence
            aggregate={aggregate}
            detailedMeasuredDriveEnergyWh={
              detailState.isResolved
                ? model.totalMeasuredDriveEnergyWh
                : 0
            }
            state={aggregateState}
          />
          <DetailedRecoveryEvidence model={model} state={detailState} />
        </div>
        {detailState.isResolved ? (
          <DetailScopeNotice
            className="mt-4"
            capReached={model.accounting.historyCapReached}
            historyLimit={model.accounting.historyLimit}
          />
        ) : null}
      </GlassPanel>
    </section>
  );
}
