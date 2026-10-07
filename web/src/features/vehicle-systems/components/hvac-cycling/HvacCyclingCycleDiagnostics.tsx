import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { AlertBanner } from '@/components/feedback';
import { Text } from '@/components/ui';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingCycleDiagnosticsProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

export function HvacCyclingCycleDiagnostics({
  summary,
  state,
}: HvacCyclingCycleDiagnosticsProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const censoredActive =
    summary.activeRunCount - summary.completeOnRunCount;
  const nonShortComplete =
    summary.completeOnRunCount - summary.shortCompleteOnRunCount;

  return (
    <section data-testid="hvac-cycling-cycle-diagnostics">
      <LayoutCard title={t('hvacCycling.cycles.title', 'Complete-cycle and short-cycle diagnostics')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.cycles.subtitle',
            'A short-cycle classification requires an active run bounded by observed off-to-on and on-to-off transitions.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="hvac-cycling-cycle-summary"
            title={t('hvacCycling.cycles.title', 'Complete-cycle and short-cycle diagnostics')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.cycles.subtitle', 'A short-cycle classification requires an active run bounded by observed off-to-on and on-to-off transitions.') }}
            metrics={[
              ...[
                { key: 'fragments', label: t('hvacCycling.cycles.activeFragments', 'Active run fragments'), value: summary.activeRunCount },
                { key: 'complete', label: t('hvacCycling.cycles.complete', 'Qualified complete active runs'), value: summary.completeOnRunCount },
                { key: 'censored', label: t('hvacCycling.cycles.censored', 'Boundary-censored active runs'), value: censoredActive },
                { key: 'short', label: t('hvacCycling.cycles.short', 'Qualified short runs'), value: summary.shortCompleteOnRunCount },
                { key: 'not-short', label: t('hvacCycling.cycles.notShort', 'Qualified non-short runs'), value: nonShortComplete },
              ].map(fact => ({
                metricId: 'count' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'rate', label: t('hvacCycling.cycles.rate', 'Short-cycle rate'), rawValue: summary.qualifiedShortCycleRate != null ? summary.qualifiedShortCycleRate * 100 : null,
                display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
            ]}
          />
          {summary.activeRunCount > 0 && summary.completeOnRunCount === 0 ? (
            <AlertBanner
              className="mt-3"
              variant="warning"
              icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
            >
              <Text as="p" variant="caption">
                {t(
                  'hvacCycling.cycles.withheld',
                  'The denominator is zero: every active fragment is left-censored, right-censored, or both. No short-cycle rate is published.',
                )}
              </Text>
            </AlertBanner>
          ) : (
            <Text as="p" variant="caption" className="mt-3">
              {t(
                'hvacCycling.cycles.denominator',
                '{{short}} short ÷ {{complete}} complete active runs; {{starts}} observed active starts are reported separately.',
                {
                  short: fmtInt(summary.shortCompleteOnRunCount),
                  complete: fmtInt(summary.completeOnRunCount),
                  starts: fmtInt(summary.observedOnStarts),
                },
              )}
            </Text>
          )}
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
