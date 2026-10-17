import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import type { RootCauseWorkspace } from '../../hooks/useRootCauseWorkspace';
import { hasSignalHistory } from '../../lib/signalEvidenceAvailability';
import { localizeRootCause } from '../../lib/rootCauseIntelligence';
import type { ServiceEvidencePackCore, ServiceEvidencePackDocument } from '../../lib/serviceEvidencePack';
import { DiagnosticEvidenceBrief } from '../operationalbrief-all/DiagnosticEvidenceBrief';

interface ServiceEvidencePackSummaryProps {
  workspace: RootCauseWorkspace;
  liveCore: ServiceEvidencePackCore;
  pack: ServiceEvidencePackDocument | null;
  canGenerate: boolean;
  evidenceState: DataState<unknown>;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function ServiceEvidencePackSummary({
  workspace, liveCore, pack, canGenerate, evidenceState, isLoading, error, onRetry,
}: ServiceEvidencePackSummaryProps) {
  const { t } = useTranslation();
  const displayAnalysis = localizeRootCause(workspace.analysis, t);
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

  const available = workspace.hasChosenSignal && evidenceState.hasData;
  const focalAvailable = available && hasSignalHistory(workspace.evidenceBundle.sources, workspace.focalSignal);
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'status', occurrenceId: 'service-evidence-quality',
      rawValue: available ? qualityLabel : null,
      label: t('rootCauseIntelligence.kpis.quality', 'Evidence quality'),
      context: t('serviceEvidencePack.kpis.qualitySubtitle', 'Drives the export gate below'),
    },
    {
      metricId: 'count', occurrenceId: 'service-evidence-signals',
      rawValue: available ? liveCore.signalEvidence.length : null,
      label: t('serviceEvidencePack.kpis.signals', 'Signals in pack'),
      context: t('serviceEvidencePack.kpis.signalsSubtitle', '{{n}} corroborating', { n: available ? corroborating : '—' }),
      display: { notation: 'source' },
    },
    {
      metricId: 'count', occurrenceId: 'service-evidence-hypotheses',
      rawValue: focalAvailable ? liveCore.hypotheses.length : null,
      label: t('serviceEvidencePack.kpis.hypotheses', 'Ranked hypotheses'),
      context: t('serviceEvidencePack.kpis.hypothesesSubtitle', 'Evidence-ranked, not diagnostic'),
      display: { notation: 'source' },
    },
    {
      metricId: 'status', occurrenceId: 'service-evidence-pack-status',
      rawValue: packStatusLabel,
      label: t('serviceEvidencePack.kpis.status', 'Pack status'),
      context: packStatusSubtitle,
    },
  ];

  return (
    <FadeIn>
      <section aria-label={t('serviceEvidencePack.kpis.sectionLabel', 'Service evidence pack metrics')}>
        <DiagnosticEvidenceBrief
          testId="service-evidence-summary"
          eyebrow={t('serviceEvidencePack.title', 'Service evidence pack')}
          title={t('diagnostics.brief.packTitle', 'Export evidence and readiness')}
          description={t('serviceEvidencePack.subtitle', 'A canonical, offline-verifiable JSON export of this evidence-ranked analysis — signal evidence, ranked hypotheses, limitations, and a SHA-256 integrity digest, never a diagnosis or proof of causation.')}
          metrics={metrics}
          state={evidenceState}
          loading={isLoading}
          error={error}
          onRetry={onRetry}
          focalSignal={workspace.focalSignal}
          windowHours={workspace.windowHours}
          hasChosenSignal={workspace.hasChosenSignal}
          sources={workspace.evidenceBundle.sources}
          summary={focalAvailable
            ? liveCore.summary === workspace.analysis.summary ? displayAnalysis.summary : liveCore.summary
            : null}
          limitations={liveCore.limitations.map((note, index) =>
            note === workspace.analysis.limitations[index] ? displayAnalysis.limitations[index]! : note)}
        />
      </section>
    </FadeIn>
  );
}
