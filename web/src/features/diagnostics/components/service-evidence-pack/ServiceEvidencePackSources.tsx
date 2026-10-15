import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { GlassPanel } from '@/components/ui';
import type { RootCauseWorkspace } from '../../hooks/useRootCauseWorkspace';
import { EvidenceSourceNotice } from '../EvidenceSourceNotice';
import { SignalWindowPicker } from '../SignalWindowPicker';

interface ServiceEvidencePackSourcesProps {
  workspace: RootCauseWorkspace;
  signalsState: DataState<unknown>;
  evidenceState: DataState<unknown>;
  updatesState: DataState<unknown>;
  onRetryUpdates: () => void;
}

export function ServiceEvidencePackSources({
  workspace, signalsState, evidenceState, updatesState, onRetryUpdates,
}: ServiceEvidencePackSourcesProps) {
  const { t } = useTranslation();
  return (
    <>
      <FadeIn>
        <StaleRefreshWarning state={signalsState} label={t('rootCauseIntelligence.picker.title', 'Choose a signal to investigate')} />
        <SignalWindowPicker
          catalog={workspace.catalog}
          signalsLoading={workspace.signalsQuery.isLoading && !signalsState.hasData}
          signalsError={signalsState.fatalError}
          onRetrySignals={() => workspace.signalsQuery.refetch()}
          focalSignal={workspace.focalSignal}
          onFocalSignalChange={workspace.setFocalSignal}
          windowHours={workspace.windowHours}
          onWindowHoursChange={workspace.setWindowHours}
        />
      </FadeIn>
      <EvidenceSourceNotice
        state={evidenceState}
        sources={workspace.evidenceBundle.sources}
        label={t('serviceEvidencePack.kpis.signals', 'Signals in pack')}
        hasChosenSignal={workspace.hasChosenSignal}
      />
      <StaleRefreshWarning state={updatesState} label={t('serviceEvidencePack.softwareUpdates', 'Software update history')} />
      {updatesState.fatalError && (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={updatesState.fatalError} onRetry={onRetryUpdates} />
        </GlassPanel>
      )}
    </>
  );
}
