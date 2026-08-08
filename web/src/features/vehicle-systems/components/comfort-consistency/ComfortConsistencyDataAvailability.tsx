import { ClipboardCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyDataAvailabilityProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
}

interface Availability {
  key: string;
  label: string;
  available: boolean;
  support: string;
}

export function ComfortConsistencyDataAvailability({
  summary,
  state,
}: ComfortConsistencyDataAvailabilityProps) {
  const { t } = useTranslation();
  const items: Availability[] = [
    {
      key: 'rows',
      label: t('comfortConsistency.availability.rows', 'Endpoint rows'),
      available: summary.rows.returnedRows > 0,
      support: fmtInt(summary.rows.returnedRows),
    },
    {
      key: 'timestamps',
      label: t('comfortConsistency.availability.timestamps', 'Chronological timeline'),
      available: summary.rows.uniqueTimestampRows > 0,
      support: fmtInt(summary.rows.uniqueTimestampRows),
    },
    {
      key: 'thermal',
      label: t('comfortConsistency.availability.thermal', 'Thermally complete rows'),
      available: summary.sources.thermallyCompleteRows > 0,
      support: fmtInt(summary.sources.thermallyCompleteRows),
    },
    {
      key: 'samples',
      label: t('comfortConsistency.availability.samples', 'Active sample metrics'),
      available: summary.analyzedSamples > 0,
      support: fmtInt(summary.analyzedSamples),
    },
    {
      key: 'intervals',
      label: t('comfortConsistency.availability.intervals', 'Duration-weighted metrics'),
      available: summary.intervals.observedActiveIntervals > 0,
      support: fmtInt(summary.intervals.observedActiveIntervals),
    },
    {
      key: 'agreement',
      label: t('comfortConsistency.availability.agreement', 'Setpoint agreement'),
      available: summary.meanSetpointDisagreementC != null,
      support: fmtInt(summary.pairedSetpointAnalyzedSamples),
    },
    {
      key: 'windows',
      label: t('comfortConsistency.availability.windows', 'Stabilization windows'),
      available: summary.stabilizationWindows.length > 0,
      support: fmtInt(summary.stabilizationWindows.length),
    },
    {
      key: 'score',
      label: t('comfortConsistency.availability.score', 'Adjusted consistency score'),
      available: summary.consistencyScore != null,
      support: summary.consistencyScore != null
        ? String(summary.consistencyScore)
        : '—',
    },
  ];

  return (
    <section data-testid="comfort-consistency-availability">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.availability.title', 'Data-availability matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.availability.subtitle',
            'Each analytical layer is published only when its own evidence gate is met.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
            {items.map((item) => (
              <div
                key={item.key}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <MetricLabel>{item.label}</MetricLabel>
                  <Badge variant={item.available ? 'success' : 'neutral'}>
                    {item.available
                      ? t('comfortConsistency.availability.available', 'Available')
                      : t('comfortConsistency.availability.withheld', 'Withheld')}
                  </Badge>
                </div>
                <Text as="p" variant="caption" className="mt-2">
                  {item.support}
                </Text>
              </div>
            ))}
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
