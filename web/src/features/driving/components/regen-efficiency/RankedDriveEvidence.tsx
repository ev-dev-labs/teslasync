import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import { RankedDriveTable } from './RankedDriveTable';
import { RegenSectionBody } from './RegenSectionBody';
import type { RegenSectionState } from './types';

interface RankedDriveEvidenceProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function RankedDriveEvidence({
  model,
  state,
}: RankedDriveEvidenceProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('regen.evidence.sectionAria', 'Ranked drive evidence')}
      data-testid="regen-evidence"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('regen.evidence.title', 'Most recovered energy by drive')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'regen.evidence.subtitle',
            'Top {{shown}} eligible drives by measured recovered energy; ties preserve returned order.',
            { shown: model.rankedDriveLimit },
          )}
        </Text>
        <RegenSectionBody
          className="mt-4"
          state={state}
          hasData={model.rankedDrives.length > 0}
          emptyIcon={<ListOrdered className="h-8 w-8" aria-hidden="true" />}
          emptyMessage={t(
            'regen.evidence.empty',
            'No eligible detailed drives are available to rank.',
          )}
          skeletonHeight={280}
        >
          <RankedDriveTable
            rows={model.rankedDrives}
            timeZone={model.timeZone}
          />
        </RegenSectionBody>
        {state.isResolved ? (
          <DetailScopeNotice
            className="mt-3"
            capReached={model.accounting.historyCapReached}
            historyLimit={model.accounting.historyLimit}
          />
        ) : null}
      </GlassPanel>
    </section>
  );
}
