import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { combineDataStates } from '@/api/dataState';

import { useRootCauseWorkspace } from '../hooks/useRootCauseWorkspace';
import { ServiceEvidencePackSources } from '../components/service-evidence-pack/ServiceEvidencePackSources';
import { ServiceEvidencePackSummary } from '../components/service-evidence-pack/ServiceEvidencePackSummary';
import {
  ServiceEvidenceInventoryTable,
  ServiceEvidencePrivacyPanel,
  ServiceEvidenceIntegrityPanel,
  ServiceEvidencePackPreview,
} from '../components';
import {
  buildServiceEvidencePack,
  buildServiceEvidencePackCore,
  buildServiceEvidencePackFilename,
  toPrettyJson,
  CryptoUnavailableError,
  type ServiceEvidencePackDocument,
} from '../lib/serviceEvidencePack';

function downloadPack(doc: ServiceEvidencePackDocument): void {
  const blob = new Blob([toPrettyJson(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildServiceEvidencePackFilename(doc);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Service Evidence Pack.
 *
 * Shares its focal-signal / window selection and root-cause analysis with
 * `RootCauseIntelligencePage` via `useRootCauseWorkspace`, then lets a
 * technician review exactly what a canonical, offline-verifiable JSON
 * export would contain — signal evidence, ranked hypotheses, limitations,
 * and a privacy manifest — before generating a SHA-256 integrity digest
 * and downloading the single canonical document.
 *
 * All hooks are called unconditionally (Rules of Hooks) before the single
 * `vehicleId == null` early return, matching `SignalChangePointsPage.tsx`.
 */
export default function ServiceEvidencePackPage() {
  const { t } = useTranslation();
  usePageTitle(t('serviceEvidencePack.title', 'Service evidence pack'));

  const { vehicleId, vehicle } = useSelectedVehicle();
  const workspace = useRootCauseWorkspace(vehicleId);
  const updatesQuery = useSoftwareUpdates(vehicleId != null ? String(vehicleId) : '');
  const signalsState = useDataState(workspace.signalsQuery, { provenance: 'historical' });
  const updatesState = useDataState(updatesQuery, { provenance: 'historical' });
  const availableHistories = workspace.evidenceBundle.data.filter(
    ({ response }) => (response.data?.length ?? 0) > 0,
  );
  const bundleState = useDataState({
    ...workspace.evidenceBundle,
    data: availableHistories.length > 0 ? availableHistories : undefined,
  }, { provenance: 'historical', partial: workspace.evidenceBundle.isError });
  const evidenceState = {
    ...bundleState,
    ...(workspace.evidenceBundle.sources.length > 0
      ? combineDataStates(workspace.evidenceBundle.sources.map(({ state }) => state))
      : {}),
  };

  const [pack, setPack] = useState<ServiceEvidencePackDocument | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const generation = useRef(0);
  const pendingGeneration = useRef<number | null>(null);

  // A previously generated pack describes a point-in-time snapshot of a
  // specific vehicle + signal + window. Any of those three changing makes
  // it stale, so it must not linger as exportable without being regenerated.
  useLayoutEffect(() => {
    generation.current += 1;
    pendingGeneration.current = null;
    setPack(null);
    setPackError(null);
    setGenerating(false);
    return () => {
      generation.current += 1;
      pendingGeneration.current = null;
    };
  }, [vehicleId, workspace.focalSignal, workspace.windowHours]);

  const liveCore = useMemo(
    () =>
      buildServiceEvidencePackCore({
        vehicle: { id: vehicleId ?? 0, displayName: vehicle?.display_name ?? '' },
        windowHours: workspace.windowHours,
        analysis: workspace.analysis,
        softwareUpdates: updatesQuery.data,
      }),
    [vehicleId, vehicle, workspace.windowHours, workspace.analysis, updatesQuery.data],
  );

  const canGenerate = workspace.hasChosenSignal && workspace.isDefensible;

  const handleGenerate = useCallback(async () => {
    if (vehicleId == null || !canGenerate || pendingGeneration.current != null) return;
    const attempt = ++generation.current;
    pendingGeneration.current = attempt;
    setGenerating(true);
    setPackError(null);
    try {
      const doc = await buildServiceEvidencePack({
        vehicle: { id: vehicleId, displayName: vehicle?.display_name ?? '' },
        windowHours: workspace.windowHours,
        analysis: workspace.analysis,
        softwareUpdates: updatesQuery.data,
      });
      if (generation.current === attempt) setPack(doc);
    } catch (err) {
      if (generation.current === attempt) {
        setPackError(
          err instanceof CryptoUnavailableError
            ? t(
                'serviceEvidencePack.errors.cryptoUnavailable',
                'This session cannot compute a SHA-256 integrity digest — Web Crypto requires a secure context (HTTPS or localhost). Try again over HTTPS.',
              )
            : t('serviceEvidencePack.errors.generic', 'Something went wrong while generating the pack. Please try again.'),
        );
      }
    } finally {
      if (generation.current === attempt) {
        pendingGeneration.current = null;
        setGenerating(false);
      }
    }
  }, [vehicleId, vehicle, workspace.windowHours, workspace.analysis, updatesQuery.data, canGenerate, t]);

  const handleDismissError = useCallback(() => setPackError(null), []);
  const handleExport = useCallback(() => {
    if (pack != null) downloadPack(pack);
  }, [pack]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('serviceEvidencePack.title', 'Service evidence pack')} />;
  }

  const isLoading = !evidenceState.hasData && (
    (workspace.signalsQuery.isLoading && !signalsState.hasData) ||
    (workspace.hasChosenSignal && workspace.evidenceBundle.isLoading)
  );
  const error = evidenceState.fatalError ?? (!workspace.hasChosenSignal ? signalsState.fatalError : null);
  const isError = !!error;
  const onRetry = () => {
    workspace.signalsQuery.refetch();
    workspace.evidenceBundle.refetch();
  };

  return (
    <PageLayout
      title={t('serviceEvidencePack.title', 'Service evidence pack')}
      subtitle={t(
        'serviceEvidencePack.subtitle',
        'A canonical, offline-verifiable JSON export of this evidence-ranked analysis — signal evidence, ranked hypotheses, limitations, and a SHA-256 integrity digest, never a diagnosis or proof of causation.',
      )}
      query={[workspace.signalsQuery, updatesQuery]}
    >
      {/* 1 — Focal signal + analysis window (shared with the Root-Cause page) */}
      <ServiceEvidencePackSources
        workspace={workspace}
        signalsState={signalsState}
        evidenceState={evidenceState}
        updatesState={updatesState}
        onRetryUpdates={() => { void updatesQuery.refetch(); }}
      />

      {/* 2 — KPI band */}
      <ServiceEvidencePackSummary
        workspace={workspace}
        liveCore={liveCore}
        pack={pack}
        canGenerate={canGenerate}
        evidenceState={evidenceState}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
      />

      {/* 3 — Evidence inventory */}
      <FadeIn>
        <ServiceEvidenceInventoryTable
          signalEvidence={liveCore.signalEvidence}
          sources={workspace.evidenceBundle.sources}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>

      {/* 4 — Privacy manifest */}
      <FadeIn>
        <ServiceEvidencePrivacyPanel />
      </FadeIn>

      {/* 5 — Integrity & export */}
      <FadeIn>
        <ServiceEvidenceIntegrityPanel
          canGenerate={canGenerate}
          generating={generating}
          pack={pack}
          generationError={packError}
          onGenerate={() => void handleGenerate()}
          onDismissError={handleDismissError}
          onExport={handleExport}
        />
      </FadeIn>

      {/* 6 — Pack preview */}
      <FadeIn>
        <ServiceEvidencePackPreview pack={pack} />
      </FadeIn>
    </PageLayout>
  );
}
