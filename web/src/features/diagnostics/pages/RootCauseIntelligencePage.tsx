import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '@/components/layout';
import type { StatMetric } from '@/components/data-display';
import { HelpTooltip } from '@/components/ui';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';


import { useRootCauseWorkspace } from '../hooks/useRootCauseWorkspace';
import { EvidenceSourceNotice } from '../components/EvidenceSourceNotice';
import { DiagnosticEvidenceBrief } from '../components/operationalbrief-all/DiagnosticEvidenceBrief';
import {
  SignalWindowPicker,
  RootCauseSignalTimelineChart,
  RootCauseEvidenceGraph,
  RootCauseHypothesisList,
  RootCauseInterpretationPanel,
} from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { hasSignalHistory } from '../lib/signalEvidenceAvailability';

/**
 * Root-Cause Intelligence Graph.
 *
 * Lets a technician pick one focal telemetry signal and an analysis window,
 * then surfaces a bounded, evidence-ranked set of hypotheses about which
 * OTHER signals moved in temporal proximity to that signal's strongest
 * robust shift. Every panel below repeats, in some form, the same hedge:
 * this is a statistical association, never a diagnosis or a claim of
 * causal proof — see `NO_CAUSAL_PROOF_DISCLAIMER` in `lib/rootCauseIntelligence.ts`.
 *
 * All hooks are called unconditionally (Rules of Hooks) before the single
 * `vehicleId == null` early return, matching `SignalChangePointsPage.tsx`.
 */
export default function RootCauseIntelligencePage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('rootCauseIntelligence.title', 'Root-cause intelligence'));

  const { vehicleId } = useSelectedVehicle();
  const workspace = useRootCauseWorkspace(vehicleId);
  const signalsState = useDataState(workspace.signalsQuery, { provenance: 'historical' });
  const evidenceState = useDataState({
    ...workspace.evidenceBundle,
    data: workspace.evidenceBundle.data.length > 0 ? workspace.evidenceBundle.data : undefined,
  }, { provenance: 'historical', partial: workspace.evidenceBundle.isError });

  const onRetry = useCallback(() => {
    workspace.signalsQuery.refetch();
    workspace.evidenceBundle.refetch();
  }, [workspace.signalsQuery, workspace.evidenceBundle]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('rootCauseIntelligence.title', 'Root-cause intelligence')} />;
  }

  const { analysis } = workspace;
  const isLoading = !evidenceState.hasData && (
    (workspace.signalsQuery.isLoading && !signalsState.hasData) ||
    (workspace.hasChosenSignal && workspace.evidenceBundle.isLoading)
  );
  const error = evidenceState.fatalError ?? (!workspace.hasChosenSignal ? signalsState.fatalError : null);
  const isError = !!error;

  const qualityLabel =
    analysis.quality.band === 'strong'
      ? t('rootCauseIntelligence.quality.strong', 'Strong evidence')
      : analysis.quality.band === 'moderate'
        ? t('rootCauseIntelligence.quality.moderate', 'Moderate evidence')
        : analysis.quality.band === 'weak'
          ? t('rootCauseIntelligence.quality.weak', 'Weak evidence')
          : t('rootCauseIntelligence.quality.insufficient', 'Insufficient evidence');

  const available = workspace.hasChosenSignal && evidenceState.hasData;
  const focalAvailable = available && hasSignalHistory(workspace.evidenceBundle.sources, workspace.focalSignal);
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'status', occurrenceId: 'root-cause-quality',
      rawValue: available ? qualityLabel : null,
      label: t('rootCauseIntelligence.kpis.quality', 'Evidence quality'),
      description: t('help.rootCauseIntelligence.quality', 'Combines focal sample coverage, corroborating-candidate ratio, and analysis window length into a single 0–1 score.'),
      context: <>
        {t('rootCauseIntelligence.kpis.qualitySubtitle', 'Overall score {{n}} of 1.00', {
          n: available && Number.isFinite(analysis.quality.overallScore)
            ? fmtNumber(analysis.quality.overallScore) : '—',
        })}
        <HelpTooltip
          i18nKey="help.rootCauseIntelligence.quality"
          defaultValue="Combines focal sample coverage, corroborating-candidate ratio, and analysis window length into a single 0–1 score."
        />
      </>,
    },
    {
      metricId: 'ratio', occurrenceId: 'root-cause-overall-score',
      rawValue: available ? analysis.quality.overallScore : null,
      label: t('diagnostics.brief.evidenceScore', 'Overall evidence score'),
      description: t('diagnostics.brief.scoreBasis', 'Existing evidence-quality score on a 0–1 scale, not a probability or causal confidence.'),
    },
    {
      metricId: 'ratio', occurrenceId: 'root-cause-effect',
      rawValue: focalAvailable ? analysis.focalShift?.effectSize : null,
      label: t('rootCauseIntelligence.kpis.effect', 'Focal shift effect size'),
      description: t('diagnostics.brief.effectBasis', 'Existing robust shift effect size; before and after medians retain their source scale.'),
      context: !focalAvailable ? t('diagnostics.brief.focalUnavailable', 'Focal history unavailable; no shift conclusion can be drawn.')
        : analysis.focalShift != null
        ? t('rootCauseIntelligence.kpis.effectSubtitle', '{{before}} → {{after}}', {
          before: fmtNumber(analysis.focalShift.before.median),
          after: fmtNumber(analysis.focalShift.after.median),
        })
        : t('rootCauseIntelligence.kpis.effectNone', 'No robust shift found'),
    },
    {
      metricId: 'count', occurrenceId: 'root-cause-hypotheses',
      rawValue: focalAvailable ? analysis.hypotheses.length : null,
      label: t('rootCauseIntelligence.kpis.hypotheses', 'Ranked hypotheses'),
      context: t('rootCauseIntelligence.kpis.hypothesesSubtitle', '{{n}} candidates considered', {
        n: analysis.relatedCandidates.length,
      }),
      display: { notation: 'source' },
    },
    {
      metricId: 'count', occurrenceId: 'root-cause-focal-samples',
      rawValue: focalAvailable
        ? analysis.quality.focalSampleCount : null,
      label: t('rootCauseIntelligence.kpis.samples', 'Focal samples'),
      context: t('rootCauseIntelligence.kpis.samplesSubtitle', '{{h}}h window', { h: workspace.windowHours }),
      display: { notation: 'source' },
    },
  ];

  return (
    <PageLayout
      title={t('rootCauseIntelligence.title', 'Root-cause intelligence')}
      subtitle={t(
        'rootCauseIntelligence.subtitle',
        "Evidence-ranked hypotheses about which telemetry signals moved alongside a chosen signal's biggest shift \u2014 a statistical association, never a diagnosis or proof of causation.",
      )}
      query={workspace.signalsQuery}
    >
      {/* 1 — Focal signal + analysis window */}
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
        summary={focalAvailable ? analysis.summary : null}
        limitations={analysis.limitations}
        label={t('rootCauseIntelligence.kpis.sectionLabel', 'Root-cause evidence metrics')}
        hasChosenSignal={workspace.hasChosenSignal}
      />

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('rootCauseIntelligence.kpis.sectionLabel', 'Root-cause evidence metrics')}
        >
          <DiagnosticEvidenceBrief
            testId="root-cause-summary"
            eyebrow={t('rootCauseIntelligence.title', 'Root-cause intelligence')}
            title={t('diagnostics.brief.analysisTitle', 'Evidence quality and focal shift')}
            description={t('rootCauseIntelligence.subtitle', "Evidence-ranked hypotheses about which telemetry signals moved alongside a chosen signal's biggest shift — a statistical association, never a diagnosis or proof of causation.")}
            metrics={metrics}
            state={evidenceState}
            loading={isLoading}
            error={error}
            onRetry={onRetry}
            focalSignal={workspace.focalSignal}
            windowHours={workspace.windowHours}
            hasChosenSignal={workspace.hasChosenSignal}
            sources={workspace.evidenceBundle.sources}
            summary={focalAvailable ? analysis.summary : null}
            limitations={analysis.limitations}
          />
        </section>
      </FadeIn>

      {/* 3 — Normalized multi-signal timeline */}
      <FadeIn delay={0.2}>
        <RootCauseSignalTimelineChart
          timeline={analysis.timeline}
          seriesNames={analysis.timelineSeriesNames}
          focalSignal={analysis.focalSignal}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>

      {/* 4 — Evidence graph */}
      <FadeIn delay={0.3}>
        <RootCauseEvidenceGraph
          graph={analysis.graph}
          sources={workspace.evidenceBundle.sources}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>

      {/* 5 — Ranked hypotheses */}
      <FadeIn delay={0.4}>
        <RootCauseHypothesisList
          hypotheses={analysis.hypotheses}
          focalHistoryAvailable={hasSignalHistory(workspace.evidenceBundle.sources, workspace.focalSignal)}
          hasChosenSignal={workspace.hasChosenSignal}
          focalShiftFound={analysis.focalShift != null}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>

      {/* 6 — Interpretation & limits */}
      <FadeIn delay={0.5}>
        <RootCauseInterpretationPanel
          summary={analysis.summary}
          focalHistoryAvailable={hasSignalHistory(workspace.evidenceBundle.sources, workspace.focalSignal)}
          limitations={analysis.limitations}
          quality={analysis.quality}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>
    </PageLayout>
  );
}
