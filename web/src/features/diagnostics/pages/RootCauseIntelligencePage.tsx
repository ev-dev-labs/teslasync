import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ArrowUpDown, ListOrdered, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';

import { useRootCauseWorkspace } from '../hooks/useRootCauseWorkspace';
import {
  SignalWindowPicker,
  RootCauseSignalTimelineChart,
  RootCauseEvidenceGraph,
  RootCauseHypothesisList,
  RootCauseInterpretationPanel,
} from '../components';
import type { EvidenceQualityBand } from '../lib/rootCauseIntelligence';

/** Mirrors `QualityBadge`'s semantics with the KPI band's `NeonColor` palette. */
const QUALITY_COLOR: Record<EvidenceQualityBand, 'green' | 'cyan' | 'amber' | 'red'> = {
  strong: 'green',
  moderate: 'cyan',
  weak: 'amber',
  insufficient: 'red',
};

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
  const { t } = useTranslation();
  usePageTitle(t('rootCauseIntelligence.title', 'Root-Cause Intelligence'));

  const { vehicleId } = useSelectedVehicle();
  const workspace = useRootCauseWorkspace(vehicleId);

  const onRetry = useCallback(() => {
    workspace.signalsQuery.refetch();
    workspace.evidenceBundle.refetch();
  }, [workspace.signalsQuery, workspace.evidenceBundle]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('rootCauseIntelligence.title', 'Root-Cause Intelligence')} />;
  }

  const { analysis } = workspace;
  const isLoading = workspace.signalsQuery.isLoading || (workspace.hasChosenSignal && workspace.evidenceBundle.isLoading);
  const isError = workspace.signalsQuery.isError || workspace.evidenceBundle.isError;
  const error = workspace.signalsQuery.error ?? workspace.evidenceBundle.error;

  const qualityLabel =
    analysis.quality.band === 'strong'
      ? t('rootCauseIntelligence.quality.strong', 'Strong evidence')
      : analysis.quality.band === 'moderate'
        ? t('rootCauseIntelligence.quality.moderate', 'Moderate evidence')
        : analysis.quality.band === 'weak'
          ? t('rootCauseIntelligence.quality.weak', 'Weak evidence')
          : t('rootCauseIntelligence.quality.insufficient', 'Insufficient evidence');

  return (
    <PageContainer
      title={t('rootCauseIntelligence.title', 'Root-Cause Intelligence')}
      subtitle={t(
        'rootCauseIntelligence.subtitle',
        "Evidence-ranked hypotheses about which telemetry signals moved alongside a chosen signal's biggest shift \u2014 a statistical association, never a diagnosis or proof of causation.",
      )}
      actions={<VehicleSelect />}
      query={workspace.signalsQuery}
    >
      {/* 1 — Focal signal + analysis window */}
      <FadeIn>
        <SignalWindowPicker
          catalog={workspace.catalog}
          signalsLoading={workspace.signalsQuery.isLoading}
          signalsError={workspace.signalsQuery.error}
          onRetrySignals={() => workspace.signalsQuery.refetch()}
          focalSignal={workspace.focalSignal}
          onFocalSignalChange={workspace.setFocalSignal}
          windowHours={workspace.windowHours}
          onWindowHoursChange={workspace.setWindowHours}
        />
      </FadeIn>

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('rootCauseIntelligence.kpis.sectionLabel', 'Root-cause evidence metrics')}
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
                label={t('rootCauseIntelligence.kpis.quality', 'Evidence Quality')}
                value={workspace.hasChosenSignal ? qualityLabel : '—'}
                subtitle={t('rootCauseIntelligence.kpis.qualitySubtitle', 'Overall score {{n}} of 1.00', {
                  n: fmtNumber(analysis.quality.overallScore, 2),
                })}
                icon={<ShieldCheck className="h-5 w-5" />}
                color={workspace.hasChosenSignal ? QUALITY_COLOR[analysis.quality.band] : 'cyan'}
                help={{
                  i18nKey: 'help.rootCauseIntelligence.quality',
                  defaultValue: 'Combines focal sample coverage, corroborating-candidate ratio, and analysis window length into a single 0–1 score.',
                }}
              />
              <MetricCard
                label={t('rootCauseIntelligence.kpis.effect', 'Focal Shift Effect Size')}
                value={analysis.focalShift != null ? fmtNumber(analysis.focalShift.effectSize, 2) : '—'}
                subtitle={
                  analysis.focalShift != null
                    ? t('rootCauseIntelligence.kpis.effectSubtitle', '{{before}} \u2192 {{after}}', {
                        before: fmtNumber(analysis.focalShift.before.median, 2),
                        after: fmtNumber(analysis.focalShift.after.median, 2),
                      })
                    : t('rootCauseIntelligence.kpis.effectNone', 'No robust shift found')
                }
                icon={<ArrowUpDown className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('rootCauseIntelligence.kpis.hypotheses', 'Ranked Hypotheses')}
                value={analysis.hypotheses.length}
                subtitle={t('rootCauseIntelligence.kpis.hypothesesSubtitle', '{{n}} candidates considered', {
                  n: analysis.relatedCandidates.length,
                })}
                icon={<ListOrdered className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('rootCauseIntelligence.kpis.samples', 'Focal Samples')}
                value={analysis.quality.focalSampleCount}
                subtitle={t('rootCauseIntelligence.kpis.samplesSubtitle', '{{h}}h window', { h: workspace.windowHours })}
                icon={<Activity className="h-5 w-5" />}
                color="cyan"
              />
            </>
          )}
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
          limitations={analysis.limitations}
          quality={analysis.quality}
          hasChosenSignal={workspace.hasChosenSignal}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
        />
      </FadeIn>
    </PageContainer>
  );
}
