import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencySetpointAgreementProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

function AgreementMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function ComfortConsistencySetpointAgreement({
  summary,
  state,
  formatDelta,
}: ComfortConsistencySetpointAgreementProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="comfort-consistency-setpoint-agreement">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.setpoints.title', 'Front-row setpoint agreement')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.setpoints.subtitle',
            'Cabin deviation uses the mean when both front-row setpoints exist and the available side when only one exists.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="samples"
        >
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            <AgreementMetric
              label={t('comfortConsistency.setpoints.paired', 'Analyzed paired-setpoint samples')}
              value={fmtInt(summary.pairedSetpointAnalyzedSamples)}
            />
            <AgreementMetric
              label={t('comfortConsistency.setpoints.single', 'Analyzed one-sided samples')}
              value={fmtInt(summary.singleSetpointAnalyzedSamples)}
            />
            <AgreementMetric
              label={t('comfortConsistency.setpoints.mean', 'Mean disagreement')}
              value={formatDelta(summary.meanSetpointDisagreementC)}
            />
            <AgreementMetric
              label={t('comfortConsistency.setpoints.median', 'Median disagreement')}
              value={formatDelta(summary.medianSetpointDisagreementC)}
            />
            <AgreementMetric
              label={t('comfortConsistency.setpoints.p90', 'P90 disagreement')}
              value={formatDelta(summary.p90SetpointDisagreementC)}
            />
            <AgreementMetric
              label={t('comfortConsistency.setpoints.overThreshold', 'Paired samples above gate')}
              value={summary.disagreementSampleShare != null
                ? fmtPercent(summary.disagreementSampleShare * 100, 1)
                : '—'}
            />
          </Grid>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'comfortConsistency.setpoints.note',
              'Agreement statistics use only analyzed active samples with both setpoints; one-sided rows still support cabin-to-target deviation.',
            )}
          </Text>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
