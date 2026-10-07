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
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencySourceAvailabilityProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
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
        {denominator > 0
          ? fmtPercent((count / denominator) * 100, 1)
          : '—'}
      </Text>
      {note ? <Text as="p" variant="caption" className="mt-1">{note}</Text> : null}
    </div>
  );
}

export function ComfortConsistencySourceAvailability({
  summary,
  state,
}: ComfortConsistencySourceAvailabilityProps) {
  const { t } = useTranslation();
  const source = summary.sources;

  return (
    <section data-testid="comfort-consistency-source-availability">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.sources.title', 'Source and field availability')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.sources.subtitle',
            'Field presence among unique timestamp-valid rows; forward-filled values are timeline evidence, not independent measurements.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, lg: 4 }} gap={3}>
            <AvailabilityCard
              label={t('comfortConsistency.sources.inside', 'Cabin temperature')}
              count={source.insideTempRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.driver', 'Driver setpoint')}
              count={source.driverSetpointRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.passenger', 'Passenger setpoint')}
              count={source.passengerSetpointRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.anyTarget', 'Any front-row setpoint')}
              count={source.anySetpointRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.paired', 'Paired front-row setpoints')}
              count={source.pairedSetpointRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.knownHvac', 'Known HVAC state')}
              count={source.knownHvacRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.activeHvac', 'Observed active HVAC')}
              count={source.activeHvacRows}
              denominator={source.denominatorRows}
            />
            <AvailabilityCard
              label={t('comfortConsistency.sources.complete', 'Thermally complete rows')}
              count={source.thermallyCompleteRows}
              denominator={source.denominatorRows}
              note={t(
                'comfortConsistency.sources.completeHint',
                'Cabin temperature plus at least one setpoint',
              )}
            />
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
