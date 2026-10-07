import { RadioTower } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingSourceAvailabilityProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

function AvailabilityCard({
  label,
  count,
  denominator,
  note,
}: {
  label: string;
  count: number;
  denominator: number;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">
        {fmtInt(count)}
        {' · '}
        {denominator > 0 ? fmtPercent((count / denominator) * 100, 1) : '—'}
      </Text>
      {note ? <Text as="p" variant="caption" className="mt-1">{note}</Text> : null}
    </div>
  );
}

export function HvacCyclingSourceAvailability({
  summary,
  state,
}: HvacCyclingSourceAvailabilityProps) {
  const { t } = useTranslation();
  const signal = summary.signals;

  return (
    <section data-testid="hvac-cycling-source-availability">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.sources.title', 'Source and signal availability')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.sources.subtitle',
            'Interpretable signal presence among unique timestamp-valid rows; availability does not imply an independent measurement.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            <AvailabilityCard
              label={t('hvacCycling.sources.power', 'HVAC power')}
              count={signal.hvacPowerRows}
              denominator={signal.denominatorRows}
            />
            <AvailabilityCard
              label={t('hvacCycling.sources.ac', 'A/C state')}
              count={signal.acRows}
              denominator={signal.denominatorRows}
            />
            <AvailabilityCard
              label={t('hvacCycling.sources.fanSpeed', 'Fan speed')}
              count={signal.fanSpeedRows}
              denominator={signal.denominatorRows}
            />
            <AvailabilityCard
              label={t('hvacCycling.sources.fanStatus', 'Fan status')}
              count={signal.fanStatusRows}
              denominator={signal.denominatorRows}
            />
            <AvailabilityCard
              label={t('hvacCycling.sources.any', 'Any interpretable input')}
              count={signal.anySignalRows}
              denominator={signal.denominatorRows}
              note={t(
                'hvacCycling.sources.anyHint',
                'Required for a known HVAC state',
              )}
            />
            <AvailabilityCard
              label={t('hvacCycling.sources.conflicts', 'Mixed on/off inputs')}
              count={signal.anyConflictRows}
              denominator={signal.denominatorRows}
              note={t(
                'hvacCycling.sources.conflictHint',
                '{{power}} power/A/C · {{fan}} fan-pair conflicts',
                {
                  power: fmtInt(signal.powerAcConflictRows),
                  fan: fmtInt(signal.fanConflictRows),
                },
              )}
            />
          </Grid>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
