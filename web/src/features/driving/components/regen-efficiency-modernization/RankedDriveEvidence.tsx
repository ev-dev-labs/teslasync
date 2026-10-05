import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice, RegenSectionBody, type RegenSectionState } from '../regen-efficiency';
import { RankedDriveTable } from './RankedDriveTable';

export function RankedDriveEvidence({ model, state }: {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('regen.evidence.sectionAria', 'Ranked drive evidence')} data-testid="regen-evidence">
      <LayoutCard
        title={t('regen.evidence.title', 'Most recovered energy by drive')}
        description={t('regen.evidence.subtitle', 'Top {{shown}} eligible drives by measured recovered energy; ties preserve returned order.', { shown: model.rankedDriveLimit })}
        footer={state.isResolved ? <DetailScopeNotice
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        /> : undefined}
      >
        <RegenSectionBody
          state={state}
          hasData={model.rankedDrives.length > 0}
          emptyMessage={t('regen.evidence.empty', 'No eligible detailed drives are available to rank.')}
          skeletonHeight={280}
        >
          <RankedDriveTable rows={model.rankedDrives} timeZone={model.timeZone} />
        </RegenSectionBody>
      </LayoutCard>
    </section>
  );
}
