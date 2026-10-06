import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ClipboardList, ListOrdered, PackageCheck } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel } from '@/components/ui';

import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';

import { useRootCauseWorkspace } from '../hooks/useRootCauseWorkspace';
import {
  SignalWindowPicker,
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
import type { EvidenceQualityBand } from '../lib/rootCauseIntelligence';

/** Mirrors `QualityBadge`'s semantics with the KPI band's `NeonColor` palette. */
const QUALITY_COLOR: Record<EvidenceQualityBand, 'green' | 'cyan' | 'amber' | 'red'> = {
  strong: 'green',
  moderate: 'cyan',
  weak: 'amber',
  insufficient: 'red',
};

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
  const evidenceState = useDataState({
    ...workspace.evidenceBundle,
    data: workspace.evidenceBundle.data.length > 0 ? workspace.evidenceBundle.data : undefined,
  }, { provenance: 'historical', partial: workspace.evidenceBundle.isError });

  const [pack, setPack] = useState<ServiceEvidencePackDocument | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // A previously generated pack describes a point-in-time snapshot of a
  // specific vehicle + signal + window. Any of those three changing makes
  // it stale, so it must not linger as exportable without being regenerated.
  useEffect(() => {
    setPack(null);
    setPackError(null);
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
    if (vehicleId == null) return;
    setGenerating(true);
    setPackError(null);
    try {
      const doc = await buildServiceEvidencePack({
        vehicle: { id: vehicleId, displayName: vehicle?.display_name ?? '' },
        windowHours: workspace.windowHours,
        analysis: workspace.analysis,
        softwareUpdates: updatesQuery.data,
      });
      setPack(doc);
    } catch (err) {
      setPackError(
        err instanceof CryptoUnavailableError
          ? t(
              'serviceEvidencePack.errors.cryptoUnavailable',
              'This session cannot compute a SHA-256 integrity digest — Web Crypto requires a secure context (HTTPS or localhost). Try again over HTTPS.',
            )
          : t('serviceEvidencePack.errors.generic', 'Something went wrong while generating the pack. Please try again.'),
      );
    } finally {
      setGenerating(false);
    }
  }, [vehicleId, vehicle, workspace.windowHours, workspace.analysis, updatesQuery.data, t]);

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

  const qualityLabel =
    liveCore.quality.band === 'strong'
      ? t('rootCauseIntelligence.quality.strong', 'Strong evidence')
      : liveCore.quality.band === 'moderate'
        ? t('rootCauseIntelligence.quality.moderate', 'Moderate evidence')
        : liveCore.quality.band === 'weak'
          ? t('rootCauseIntelligence.quality.weak', 'Weak evidence')
          : t('rootCauseIntelligence.quality.insufficient', 'Insufficient evidence');

  const corroborating = liveCore.signalEvidence.filter((s) => s.hasEvidence).length;
  const packStatusLabel = pack
    ? t('serviceEvidencePack.kpis.statusGenerated', 'Generated')
    : canGenerate
      ? t('serviceEvidencePack.kpis.statusReady', 'Ready')
      : t('serviceEvidencePack.kpis.statusNotReady', 'Not ready');
  const packStatusSubtitle = pack
    ? t('serviceEvidencePack.kpis.statusDigest', 'Digest {{digest}}…', { digest: pack.integrity.digestHex.slice(0, 10) })
    : canGenerate
      ? t('serviceEvidencePack.kpis.statusReadyHint', 'Generate below to compute its digest')
      : t('serviceEvidencePack.kpis.statusNotReadyHint', 'Needs stronger evidence first');

  return (
    <PageLayout
      title={t('serviceEvidencePack.title', 'Service evidence pack')}
      subtitle={t(
        'serviceEvidencePack.subtitle',
        'A canonical, offline-verifiable JSON export of this evidence-ranked analysis — signal evidence, ranked hypotheses, limitations, and a SHA-256 integrity digest, never a diagnosis or proof of causation.',
      )}
      query={workspace.signalsQuery}
    >
      {/* 1 — Focal signal + analysis window (shared with the Root-Cause page) */}
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
      <StaleRefreshWarning state={evidenceState} label={t('serviceEvidencePack.kpis.signals', 'Signals in pack')} />
      <StaleRefreshWarning state={updatesState} label={t('serviceEvidencePack.softwareUpdates', 'Software update history')} />
      {updatesState.fatalError && (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={updatesState.fatalError} onRetry={() => { void updatesQuery.refetch(); }} />
        </GlassPanel>
      )}

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('serviceEvidencePack.kpis.sectionLabel', 'Service evidence pack metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={onRetry} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('rootCauseIntelligence.kpis.quality', 'Evidence quality')}
                value={workspace.hasChosenSignal ? qualityLabel : '—'}
                subtitle={t('serviceEvidencePack.kpis.qualitySubtitle', 'Drives the export gate below')}
                icon={<ShieldCheck className="h-5 w-5" />}
                color={workspace.hasChosenSignal ? QUALITY_COLOR[liveCore.quality.band] : 'cyan'}
              />
              <MetricCard
                label={t('serviceEvidencePack.kpis.signals', 'Signals in pack')}
                value={liveCore.signalEvidence.length}
                subtitle={t('serviceEvidencePack.kpis.signalsSubtitle', '{{n}} corroborating', { n: corroborating })}
                icon={<ClipboardList className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('serviceEvidencePack.kpis.hypotheses', 'Ranked hypotheses')}
                value={liveCore.hypotheses.length}
                subtitle={t('serviceEvidencePack.kpis.hypothesesSubtitle', 'Evidence-ranked, not diagnostic')}
                icon={<ListOrdered className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('serviceEvidencePack.kpis.status', 'Pack status')}
                value={packStatusLabel}
                subtitle={packStatusSubtitle}
                icon={<PackageCheck className="h-5 w-5" />}
                color={pack ? 'green' : canGenerate ? 'cyan' : 'amber'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 3 — Evidence inventory */}
      <FadeIn delay={0.2}>
        <ServiceEvidenceInventoryTable
          signalEvidence={liveCore.signalEvidence}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>

      {/* 4 — Privacy manifest */}
      <FadeIn delay={0.3}>
        <ServiceEvidencePrivacyPanel />
      </FadeIn>

      {/* 5 — Integrity & export */}
      <FadeIn delay={0.4}>
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
      <FadeIn delay={0.5}>
        <ServiceEvidencePackPreview pack={pack} />
      </FadeIn>
    </PageLayout>
  );
}
