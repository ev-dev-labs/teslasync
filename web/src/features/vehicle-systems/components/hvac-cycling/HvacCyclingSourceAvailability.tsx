import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt, fmtPercent } = useNumberFormatting();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">
        {fmtInt(count)}
        {' · '}
        {denominator > 0 ? fmtPercent((count / denominator) * 100) : '—'}
      </Text>
      {note ? <Text as="p" variant="caption" className="mt-1">{note}</Text> : null}
    </div>
  );
}

export function HvacCyclingSourceAvailability({
  summary,
  state,
}: HvacCyclingSourceAvailabilityProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const signal = summary.signals;

  return (
    <section data-testid="hvac-cycling-source-availability">
      <LayoutCard title={t('hvacCycling.sources.title', 'Source and signal availability')}>
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
      </LayoutCard>
    </section>
  );
}
