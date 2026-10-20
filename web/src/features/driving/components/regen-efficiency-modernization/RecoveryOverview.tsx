import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import type { RegenEfficiencyData } from '@/types/driving';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, type RegenSectionState } from '../regen-efficiency';
import { AggregateRecoveryEvidence } from './AggregateRecoveryEvidence';
import { DetailedRecoveryEvidence } from './DetailedRecoveryEvidence';
import { RegenCardSlot } from './RegenCardSlot';

interface RecoveryOverviewProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
}

export function RecoveryOverview({
  aggregate, model, aggregateState, detailState,
}: RecoveryOverviewProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="regen-overview" aria-label={t('regen.overview.aria', 'Aggregate and detailed recovery overview')}>
      <LayoutCard
        title={t('regen.overview.title', 'Recovery overview')}
        footer={detailState.isResolved ? <DetailScopeNotice
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        /> : undefined}
      >
        <CardGrid
          label={t('regen.overview.aria', 'Aggregate and detailed recovery overview')}
          items={[
            {
              id: 'regen-aggregate-evidence',
              size: 'half',
              content: <RegenCardSlot><AggregateRecoveryEvidence
                aggregate={aggregate}
                detailedMeasuredDriveEnergyWh={detailState.isResolved ? model.totalMeasuredDriveEnergyWh : 0}
                state={aggregateState}
              /></RegenCardSlot>,
            },
            {
              id: 'regen-detail-evidence',
              size: 'half',
              content: <RegenCardSlot><DetailedRecoveryEvidence model={model} state={detailState} /></RegenCardSlot>,
            },
          ]}
        />
      </LayoutCard>
    </section>
  );
}
