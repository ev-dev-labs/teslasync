import { ListChecks } from 'lucide-react';
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
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingDataAvailabilityProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

interface Availability {
  key: string;
  label: string;
  available: boolean;
  support: string;
}

export function HvacCyclingDataAvailability({
  summary,
  state,
}: HvacCyclingDataAvailabilityProps) {
  const { t } = useTranslation();
  const items: Availability[] = [
    {
      key: 'rows',
      label: t('hvacCycling.availability.rows', 'Endpoint rows'),
      available: summary.rows.returnedRows > 0,
      support: fmtInt(summary.rows.returnedRows),
    },
    {
      key: 'timestamps',
      label: t('hvacCycling.availability.timestamps', 'Unique valid timestamps'),
      available: summary.rows.uniqueTimestampRows > 0,
      support: fmtInt(summary.rows.uniqueTimestampRows),
    },
    {
      key: 'states',
      label: t('hvacCycling.availability.states', 'Interpretable HVAC states'),
      available: summary.rows.validKnownStateRows > 0,
      support: fmtInt(summary.rows.validKnownStateRows),
    },
    {
      key: 'intervals',
      label: t('hvacCycling.availability.intervals', 'Observed interval duty'),
      available: summary.intervals.observedIntervals > 0,
      support: fmtInt(summary.intervals.observedIntervals),
    },
    {
      key: 'runs',
      label: t('hvacCycling.availability.runs', 'Run-length evidence'),
      available: summary.runs.length > 0,
      support: fmtInt(summary.runs.length),
    },
    {
      key: 'transitions',
      label: t('hvacCycling.availability.transitions', 'Observed state transitions'),
      available: summary.transitionCount > 0,
      support: fmtInt(summary.transitionCount),
    },
    {
      key: 'cycles',
      label: t('hvacCycling.availability.cycles', 'Complete active cycles'),
      available: summary.completeCycles > 0,
      support: fmtInt(summary.completeCycles),
    },
    {
      key: 'short',
      label: t('hvacCycling.availability.short', 'Short-cycle conclusion'),
      available: summary.qualifiedShortCycleRate != null,
      support: t(
        'hvacCycling.availability.denominator',
        '{{count}}-run denominator',
        { count: summary.completeOnRunCount },
      ),
    },
  ];

  return (
    <section data-testid="hvac-cycling-availability">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.availability.title', 'Data-availability matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.availability.subtitle',
            'Each analytical layer is published only when its own evidence gate is met.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
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
                      ? t('hvacCycling.availability.available', 'Available')
                      : t('hvacCycling.availability.withheld', 'Withheld')}
                  </Badge>
                </div>
                <Text as="p" variant="caption" className="mt-2">
                  {item.support}
                </Text>
              </div>
            ))}
          </Grid>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
