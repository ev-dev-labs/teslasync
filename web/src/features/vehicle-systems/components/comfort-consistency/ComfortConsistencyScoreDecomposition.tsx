import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencyScoreDecompositionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencyScoreDecomposition({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyScoreDecompositionProps) {
  const { fmtPercent, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const score = summary.score;

  return (
    <section data-testid="comfort-consistency-score-decomposition">
      <LayoutCard title={t('comfortConsistency.score.title', 'Score decomposition and confidence')}>
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
          <VehicleOperationalBrief embedded id="comfort-consistency-score-summary"
            title={t('comfortConsistency.score.title', 'Score decomposition and confidence')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.score.notice', 'Confidence reflects active-sample and outside-band-fragment volume. Missing paired-setpoint or stabilization evidence leaves its component neutral; this is not a Tesla specification or diagnostic grade.') }}
            metrics={[
              ...[
                { key: 'band', label: t('comfortConsistency.score.band', 'Band adherence'), value: score.bandAdherence, note: t('comfortConsistency.score.bandWeight', '50% weight') },
                { key: 'deviation', label: t('comfortConsistency.score.deviation', 'Deviation component'), value: score.deviationScore, note: t('comfortConsistency.score.deviationWeight', '25% weight; zero at {{value}}', { value: formatDelta(score.deviationZeroC) }) },
                { key: 'agreement', label: t('comfortConsistency.score.agreement', 'Setpoint agreement'), value: score.agreementScore, note: t('comfortConsistency.score.agreementWeight', '15% weight; zero at {{value}}', { value: formatDelta(score.agreementZeroC) }) },
                { key: 'stabilization', label: t('comfortConsistency.score.stabilization', 'Stabilization component'), value: score.stabilizationScore, note: t('comfortConsistency.score.stabilizationWeight', '10% weight; zero at {{value}}', { value: formatDuration(score.stabilizationZeroS) }) },
                { key: 'sample-confidence', label: t('comfortConsistency.score.sampleConfidence', 'Sample confidence'), value: score.sampleConfidence, note: t('comfortConsistency.score.sampleConfidenceHint', 'full support at {{count}} active samples', { count: score.fullSampleConfidenceAt }) },
                { key: 'window-confidence', label: t('comfortConsistency.score.windowConfidence', 'Window confidence'), value: score.windowConfidence, note: t('comfortConsistency.score.windowConfidenceHint', 'full support at {{count}} outside-band fragments', { count: score.fullWindowConfidenceAt }) },
              ].map(fact => ({
                metricId: 'percent' as const, occurrenceId: fact.key, label: fact.label,
                rawValue: fact.value != null ? fact.value * 100 : null, description: fact.note,
                display: { formatter: (raw: number) => ({ value: fmtPercent(raw), unit: '' }) },
              })),
              ...[
                { key: 'raw', label: t('comfortConsistency.score.raw', 'Raw blended score'), value: score.rawScore, note: t('comfortConsistency.score.rawHint', 'before confidence shrinkage') },
                { key: 'adjusted', label: t('comfortConsistency.score.adjusted', 'Published adjusted score'), value: score.adjustedScore, note: t('comfortConsistency.score.adjustedHint', 'shrunk toward neutral 50') },
              ].map(fact => ({
                metricId: 'number' as const, occurrenceId: fact.key, label: fact.label,
                rawValue: fact.value, description: fact.note,
                display: { formatter: (raw: number) => ({ value: fmtNumber(raw), unit: '' }) },
              })),
            ]}
          />
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'comfortConsistency.score.notice',
              'Confidence reflects active-sample and outside-band-fragment volume. Missing paired-setpoint or stabilization evidence leaves its component neutral; this is not a Tesla specification or diagnostic grade.',
            )}
          </Text>
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
