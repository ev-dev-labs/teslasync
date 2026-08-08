import {
  BatteryCharging,
  CalendarRange,
  Car,
  Database,
  GitMerge,
  Rows3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { formatDate } from '@/lib/dateFormat';
import type {
  CycleSourceCoverage,
  CycleStressResult,
} from '../../lib/cycleStress';
import { cycleStressNumber } from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressSourceCoverageProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

function coverageRange(
  coverage: CycleSourceCoverage,
  locale: string,
  timeZone: string,
): string {
  if (
    coverage.firstObservationMs == null
    || coverage.lastObservationMs == null
  ) {
    return '—';
  }
  const options = { locale, tz: timeZone };
  return `${formatDate(
    new Date(coverage.firstObservationMs),
    options,
  )} - ${formatDate(
    new Date(coverage.lastObservationMs),
    options,
  )}`;
}

export function CycleStressSourceCoverage({
  result,
  state,
  locale,
}: CycleStressSourceCoverageProps) {
  const { t } = useTranslation();
  const drive = result.coverage.drive;
  const charging = result.coverage.charging;
  const driveUnavailable = [
    ...state.failedSources,
    ...state.loadingSources,
  ].includes('drive');
  const chargingUnavailable = [
    ...state.failedSources,
    ...state.loadingSources,
  ].includes('charging');
  const unavailable = t(
    'cycleStress.states.sourceUnavailable',
    'Source unavailable or pending',
  );

  return (
    <section data-testid="cycle-stress-source-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.coverage.title',
            'Independent source coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.coverage.subtitle',
            'Drive and charging requests are capped independently, so their returned spans and contribution can differ.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t(
                'cycleStress.coverage.driveReturned',
                'Drive rows returned',
              )}
              value={
                driveUnavailable
                  ? '—'
                  : cycleStressNumber(drive.returnedRows, locale, 0)
              }
              subtitle={
                driveUnavailable
                  ? unavailable
                  : t(
                      'cycleStress.coverage.acceptedCount',
                      '{{count}} accepted',
                      { count: drive.includedRows },
                    )
              }
              icon={<Car className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.driveSpan',
                'Drive evidence span',
              )}
              value={
                driveUnavailable || drive.observedSpanDays == null
                  ? '—'
                  : t(
                      'cycleStress.coverage.days',
                      '{{value}} days',
                      {
                        value: cycleStressNumber(
                          drive.observedSpanDays,
                          locale,
                          1,
                        ),
                      },
                    )
              }
              subtitle={
                driveUnavailable
                  ? unavailable
                  : coverageRange(
                      drive,
                      locale,
                      result.timeZone,
                    )
              }
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.chargeReturned',
                'Charging rows returned',
              )}
              value={
                chargingUnavailable
                  ? '—'
                  : cycleStressNumber(
                      charging.returnedRows,
                      locale,
                      0,
                    )
              }
              subtitle={
                chargingUnavailable
                  ? unavailable
                  : t(
                      'cycleStress.coverage.acceptedCount',
                      '{{count}} accepted',
                      { count: charging.includedRows },
                    )
              }
              icon={<BatteryCharging className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.chargeSpan',
                'Charging evidence span',
              )}
              value={
                chargingUnavailable
                || charging.observedSpanDays == null
                  ? '—'
                  : t(
                      'cycleStress.coverage.days',
                      '{{value}} days',
                      {
                        value: cycleStressNumber(
                          charging.observedSpanDays,
                          locale,
                          1,
                        ),
                      },
                    )
              }
              subtitle={
                chargingUnavailable
                  ? unavailable
                  : coverageRange(
                      charging,
                      locale,
                      result.timeZone,
                    )
              }
              icon={<CalendarRange className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.commonOverlap',
                'Common source overlap',
              )}
              value={
                result.coverage.commonSourceOverlapDays == null
                  ? '—'
                  : t(
                      'cycleStress.coverage.days',
                      '{{value}} days',
                      {
                        value: cycleStressNumber(
                          result.coverage.commonSourceOverlapDays,
                          locale,
                          1,
                        ),
                      },
                    )
              }
              subtitle={t(
                'cycleStress.coverage.overlapHint',
                'calendar time covered by both sources',
              )}
              icon={<GitMerge className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.combinedSpan',
                'Combined observed span',
              )}
              value={
                result.coverage.observedSpanDays == null
                  ? '—'
                  : t(
                      'cycleStress.coverage.days',
                      '{{value}} days',
                      {
                        value: cycleStressNumber(
                          result.coverage.observedSpanDays,
                          locale,
                          0,
                        ),
                      },
                    )
              }
              subtitle={t(
                'cycleStress.coverage.localCalendar',
                '{{zone}} local calendar',
                { zone: result.timeZone },
              )}
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.activeDays',
                'Active local days',
              )}
              value={cycleStressNumber(
                result.coverage.activeLocalDays,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.coverage.retainedEndpoints',
                'days with retained endpoints',
              )}
              icon={<Rows3 className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.coverage.requestCaps',
                'Per-source request cap',
              )}
              value={cycleStressNumber(
                result.config.historyLimit,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.coverage.capStatus',
                'drive: {{drive}}; charging: {{charging}}',
                {
                  drive: drive.historyCapReached
                    ? t('cycleStress.coverage.reached', 'reached')
                    : driveUnavailable
                      ? unavailable
                      : t(
                          'cycleStress.coverage.notReached',
                          'not reached',
                        ),
                  charging: charging.historyCapReached
                    ? t('cycleStress.coverage.reached', 'reached')
                    : chargingUnavailable
                      ? unavailable
                      : t(
                          'cycleStress.coverage.notReached',
                          'not reached',
                        ),
                },
              )}
              icon={<Database className="h-5 w-5" />}
              color="red"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'cycleStress.coverage.notice',
                'No artificial common start date is imposed. Instead, conservative continuity rules prevent reconstructed cycles from crossing unsupported time gaps or endpoint jumps, while each source span remains visible here.',
              )}
            </Text>
          </AlertBanner>
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
