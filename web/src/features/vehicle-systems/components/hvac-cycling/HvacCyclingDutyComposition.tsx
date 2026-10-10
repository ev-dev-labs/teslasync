import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingDutyCompositionProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

export function HvacCyclingDutyComposition({
  summary,
  state,
  formatDuration,
}: HvacCyclingDutyCompositionProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();

  return (
    <section data-testid="hvac-cycling-duty-composition">
      <LayoutCard title={t('hvacCycling.duty.title', 'On/off duty composition')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.duty.subtitle',
            'Duration composition uses observed intervals; sample counts remain a separate evidence layer.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state} requirement="intervals">
          <VehicleOperationalBrief embedded id="hvac-cycling-duty-summary"
            title={t('hvacCycling.duty.title', 'On/off duty composition')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.duty.subtitle', 'Duration composition uses observed intervals; sample counts remain a separate evidence layer.') }}
            metrics={[
              ...[
                { key: 'on', label: t('hvacCycling.duty.onTime', 'Observed on time'), value: summary.totalOnObservedS },
                { key: 'off', label: t('hvacCycling.duty.offTime', 'Observed off time'), value: summary.totalOffObservedS },
                { key: 'total', label: t('hvacCycling.duty.totalTime', 'Total observed time'), value: summary.observedS },
              ].map(fact => ({
                metricId: 'duration' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'duty', label: t('hvacCycling.duty.dutyCycle', 'Duration-weighted on duty'), rawValue: summary.dutyCycle != null ? summary.dutyCycle * 100 : null,
                display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'on-samples', label: t('hvacCycling.duty.onSamples', 'Known on-state samples'), rawValue: summary.rows.knownOnRows,
                display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'off-samples', label: t('hvacCycling.duty.offSamples', 'Known off-state samples'), rawValue: summary.rows.knownOffRows,
                display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
            ]}
          />
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'hvacCycling.duty.identity',
              '{{observed}} observed = {{on}} on + {{off}} off.',
              {
                observed: formatDuration(summary.observedS),
                on: formatDuration(summary.totalOnObservedS),
                off: formatDuration(summary.totalOffObservedS),
              },
            )}
          </Text>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
