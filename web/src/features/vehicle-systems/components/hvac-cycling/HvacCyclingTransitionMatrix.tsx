import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { MetricLabel, MetricValue, Text } from '@/components/ui';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingTransitionMatrixProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

function MatrixCell({ label, value }: { label: string; value: number }) {
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
    </div>
  );
}

export function HvacCyclingTransitionMatrix({
  summary,
  state,
}: HvacCyclingTransitionMatrixProps) {
  const { t } = useTranslation();
  const matrix = summary.transitions;

  return (
    <section data-testid="hvac-cycling-transition-matrix">
      <LayoutCard title={t('hvacCycling.transitions.title', 'Observed transition matrix')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.transitions.subtitle',
            'Direction changes require a gap-qualified adjacent pair with interpretable states on both ends.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state} requirement="intervals">
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            <MatrixCell
              label={t('hvacCycling.transitions.offOff', 'Off → off')}
              value={matrix.offToOff}
            />
            <MatrixCell
              label={t('hvacCycling.transitions.offOn', 'Off → on')}
              value={matrix.offToOn}
            />
            <MatrixCell
              label={t('hvacCycling.transitions.onOff', 'On → off')}
              value={matrix.onToOff}
            />
            <MatrixCell
              label={t('hvacCycling.transitions.onOn', 'On → on')}
              value={matrix.onToOn}
            />
            <MatrixCell
              label={t('hvacCycling.transitions.toUnknown', 'Known → unknown endpoint')}
              value={matrix.knownToUnknown}
            />
            <MatrixCell
              label={t('hvacCycling.transitions.total', 'Observed state transitions')}
              value={summary.transitionCount}
            />
          </Grid>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'hvacCycling.transitions.starts',
              '{{count}} off-to-on transitions qualify as observed active starts; boundary-censored active fragments do not.',
              { count: summary.observedOnStarts },
            )}
          </Text>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
