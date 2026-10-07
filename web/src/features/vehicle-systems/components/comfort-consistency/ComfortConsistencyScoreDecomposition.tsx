import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyScoreDecompositionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function ScoreMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
      <Text as="p" variant="caption" className="mt-1">{note}</Text>
    </div>
  );
}

export function ComfortConsistencyScoreDecomposition({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyScoreDecompositionProps) {
  const { t } = useTranslation();
  const score = summary.score;
  const percent = (value: number | null) =>
    value != null ? fmtPercent(value * 100, 1) : '—';

  return (
    <section data-testid="comfort-consistency-score-decomposition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.score.title', 'Score decomposition and confidence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.score.subtitle',
            'The descriptive score blends four disclosed components, then shrinks the raw result toward neutral when evidence is thin.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="samples"
        >
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <ScoreMetric
              label={t('comfortConsistency.score.band', 'Band adherence')}
              value={percent(score.bandAdherence)}
              note={t('comfortConsistency.score.bandWeight', '50% weight')}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.deviation', 'Deviation component')}
              value={percent(score.deviationScore)}
              note={t(
                'comfortConsistency.score.deviationWeight',
                '25% weight; zero at {{value}}',
                { value: formatDelta(score.deviationZeroC) },
              )}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.agreement', 'Setpoint agreement')}
              value={percent(score.agreementScore)}
              note={t(
                'comfortConsistency.score.agreementWeight',
                '15% weight; zero at {{value}}',
                { value: formatDelta(score.agreementZeroC) },
              )}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.stabilization', 'Stabilization component')}
              value={percent(score.stabilizationScore)}
              note={t(
                'comfortConsistency.score.stabilizationWeight',
                '10% weight; zero at {{value}}',
                {
                  value: formatDuration(score.stabilizationZeroS, {
                    precision: 2,
                  }),
                },
              )}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.raw', 'Raw blended score')}
              value={score.rawScore != null ? fmtNumber(score.rawScore, 1) : '—'}
              note={t('comfortConsistency.score.rawHint', 'before confidence shrinkage')}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.adjusted', 'Published adjusted score')}
              value={score.adjustedScore != null ? fmtNumber(score.adjustedScore, 0) : '—'}
              note={t('comfortConsistency.score.adjustedHint', 'shrunk toward neutral 50')}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.sampleConfidence', 'Sample confidence')}
              value={percent(score.sampleConfidence)}
              note={t(
                'comfortConsistency.score.sampleConfidenceHint',
                'full support at {{count}} active samples',
                { count: score.fullSampleConfidenceAt },
              )}
            />
            <ScoreMetric
              label={t('comfortConsistency.score.windowConfidence', 'Window confidence')}
              value={percent(score.windowConfidence)}
              note={t(
                'comfortConsistency.score.windowConfidenceHint',
                'full support at {{count}} outside-band fragments',
                { count: score.fullWindowConfidenceAt },
              )}
            />
          </Grid>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'comfortConsistency.score.notice',
              'Confidence reflects active-sample and outside-band-fragment volume. Missing paired-setpoint or stabilization evidence leaves its component neutral; this is not a Tesla specification or diagnostic grade.',
            )}
          </Text>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
