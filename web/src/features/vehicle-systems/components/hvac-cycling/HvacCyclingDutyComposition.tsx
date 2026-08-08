import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingDutyCompositionProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

function DutyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function HvacCyclingDutyComposition({
  summary,
  state,
  formatDuration,
}: HvacCyclingDutyCompositionProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="hvac-cycling-duty-composition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.duty.title', 'On/off duty composition')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.duty.subtitle',
            'Duration composition uses observed intervals; sample counts remain a separate evidence layer.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state} requirement="intervals">
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            <DutyMetric
              label={t('hvacCycling.duty.onTime', 'Observed on time')}
              value={formatDuration(summary.totalOnObservedS, { precision: 1 })}
            />
            <DutyMetric
              label={t('hvacCycling.duty.offTime', 'Observed off time')}
              value={formatDuration(summary.totalOffObservedS, { precision: 1 })}
            />
            <DutyMetric
              label={t('hvacCycling.duty.totalTime', 'Total observed time')}
              value={formatDuration(summary.observedS, { precision: 1 })}
            />
            <DutyMetric
              label={t('hvacCycling.duty.dutyCycle', 'Duration-weighted on duty')}
              value={summary.dutyCycle != null
                ? fmtPercent(summary.dutyCycle * 100, 1)
                : '—'}
            />
            <DutyMetric
              label={t('hvacCycling.duty.onSamples', 'Known on-state samples')}
              value={fmtInt(summary.rows.knownOnRows)}
            />
            <DutyMetric
              label={t('hvacCycling.duty.offSamples', 'Known off-state samples')}
              value={fmtInt(summary.rows.knownOffRows)}
            />
          </Grid>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'hvacCycling.duty.identity',
              '{{observed}} observed = {{on}} on + {{off}} off.',
              {
                observed: formatDuration(summary.observedS, { precision: 1 }),
                on: formatDuration(summary.totalOnObservedS, { precision: 1 }),
                off: formatDuration(summary.totalOffObservedS, { precision: 1 }),
              },
            )}
          </Text>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
