import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingDataAvailabilityProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

interface Availability {
  key: string;
  label: string;
  available: boolean;
  support: number;
}

export function HvacCyclingDataAvailability({
  summary,
  state,
}: HvacCyclingDataAvailabilityProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const items: Availability[] = [
    {
      key: 'rows',
      label: t('hvacCycling.availability.rows', 'Endpoint rows'),
      available: summary.rows.returnedRows > 0,
      support: summary.rows.returnedRows,
    },
    {
      key: 'timestamps',
      label: t('hvacCycling.availability.timestamps', 'Unique valid timestamps'),
      available: summary.rows.uniqueTimestampRows > 0,
      support: summary.rows.uniqueTimestampRows,
    },
    {
      key: 'states',
      label: t('hvacCycling.availability.states', 'Interpretable HVAC states'),
      available: summary.rows.validKnownStateRows > 0,
      support: summary.rows.validKnownStateRows,
    },
    {
      key: 'intervals',
      label: t('hvacCycling.availability.intervals', 'Observed interval duty'),
      available: summary.intervals.observedIntervals > 0,
      support: summary.intervals.observedIntervals,
    },
    {
      key: 'runs',
      label: t('hvacCycling.availability.runs', 'Run-length evidence'),
      available: summary.runs.length > 0,
      support: summary.runs.length,
    },
    {
      key: 'transitions',
      label: t('hvacCycling.availability.transitions', 'Observed state transitions'),
      available: summary.transitionCount > 0,
      support: summary.transitionCount,
    },
    {
      key: 'cycles',
      label: t('hvacCycling.availability.cycles', 'Complete active cycles'),
      available: summary.completeCycles > 0,
      support: summary.completeCycles,
    },
    {
      key: 'short',
      label: t('hvacCycling.availability.short', 'Short-cycle conclusion'),
      available: summary.qualifiedShortCycleRate != null,
      support: summary.completeOnRunCount,
    },
  ];

  return (
    <section data-testid="hvac-cycling-availability">
      <LayoutCard title={t('hvacCycling.availability.title', 'Data-availability matrix')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.availability.subtitle',
            'Each analytical layer is published only when its own evidence gate is met.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="hvac-cycling-availability-summary"
            title={t('hvacCycling.availability.title', 'Data-availability matrix')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.availability.subtitle', 'Each analytical layer is published only when its own evidence gate is met.') }}
            metrics={items.map(item => ({
              metricId: 'count' as const, occurrenceId: item.key, label: item.label, rawValue: item.support,
              display: { formatter: (raw: number) => ({ value: item.key === 'short'
                ? t('hvacCycling.availability.denominator', '{{count}}-run denominator', { count: raw })
                : fmtInt(raw), unit: '' }) },
              context: <Badge variant={item.available ? 'success' : 'neutral'}>
                {item.available ? t('hvacCycling.availability.available', 'Available')
                  : t('hvacCycling.availability.withheld', 'Withheld')}
              </Badge>,
            }))}
          />
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
