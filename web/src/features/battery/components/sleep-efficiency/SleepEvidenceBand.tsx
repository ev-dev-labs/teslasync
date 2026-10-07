import {
  BarChart3,
  CalendarDays,
  Clock3,
  Database,
  Eye,
  Moon,
  Scale,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import {
  AlertBanner,
  QueryError,
  Skeleton,
} from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { SleepEfficiencySectionProps } from './types';

export function SleepEvidenceBand({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const rangeValue =
    analysis.range.status === 'valid'
    && analysis.range.requestedStart
    && analysis.range.requestedEnd
      ? t(
          'sleep.kpi.rangeValue',
          '{{start}} to {{end}} UTC',
          {
            start: analysis.range.requestedStart,
            end: analysis.range.requestedEnd,
          },
        )
      : t('sleep.common.unavailable', 'Unavailable');
  const hasResponse = analysis.source.hasResponse;
  const sentryAvailability = analysis.sentry.comparisonAvailable
    ? t('sleep.availability.status.available', 'Available')
    : analysis.sentry.hasAnyEvidence
      ? t('sleep.availability.status.partial', 'Partial')
      : t('sleep.availability.status.unavailable', 'Unavailable');

  return (
    <section data-testid="sleep-efficiency-kpi-evidence">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('sleep.kpi.title', 'Evidence overview')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.kpi.description',
            'Counts, duration derivations, and source breadth are kept separate so unavailable evidence is never rendered as a measured zero.',
          )}
        </Text>

        {state.isLoading ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            role="status"
            aria-label={t(
              'sleep.states.loadingAria',
              'Loading sleep evidence',
            )}
          >
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} height={92} />
            ))}
          </div>
        ) : state.error ? (
          <div data-testid="sleep-query-initial-error" className="mt-4">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
                label={t('sleep.kpi.utcWindow', 'Selected UTC window')}
                value={rangeValue}
                color="cyan"
                subtitle={
                  analysis.range.inclusiveDays != null
                    ? t(
                        'sleep.kpi.inclusiveDays',
                        '{{count}} inclusive calendar days',
                        { count: analysis.range.inclusiveDays },
                      )
                    : t(
                        'sleep.kpi.invalidWindow',
                        'No valid inclusive day count',
                      )
                }
              />
              <MetricCard
                icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.transitionDestinations',
                  'Valid transition destinations',
                )}
                value={
                  hasResponse
                    ? fmtInt(analysis.transitions.totalCount)
                    : '—'
                }
                color="blue"
                subtitle={t(
                  'sleep.kpi.transitionSubtitle',
                  'Destination counts from the vehicle FSM',
                )}
              />
              <MetricCard
                icon={<Moon className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.asleepTransitionShare',
                  'Asleep-transition share',
                )}
                value={
                  analysis.transitions.asleepShare != null
                    ? t('sleep.kpi.percentValue', '{{value}}%', {
                        value: fmtNumber(
                          analysis.transitions.asleepShare * 100,
                        ),
                      })
                    : '—'
                }
                color="purple"
                subtitle={t(
                  'sleep.kpi.countBasedNotTime',
                  'Count-based; not a time share',
                )}
              />
              <MetricCard
                icon={<Scale className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.durationEfficiency',
                  'Duration-based sleep efficiency',
                )}
                value={
                  analysis.dwell.recomputedEfficiencyPct != null
                    ? t('sleep.kpi.percentValue', '{{value}}%', {
                        value: fmtNumber(
                          analysis.dwell.recomputedEfficiencyPct,
                        ),
                      })
                    : '—'
                }
                color="green"
                subtitle={
                  analysis.dwell.available
                    ? t(
                        'sleep.kpi.durationEvidence',
                        'Derived from positive dwell minutes',
                      )
                    : t(
                        'sleep.kpi.dwellPending',
                        'Unavailable pending dwell reconstruction',
                      )
                }
              />
              <MetricCard
                icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.averageTimeToSleep',
                  'Average time-to-sleep',
                )}
                value={
                  analysis.dwell.timeToSleepAvgMin != null
                    ? t('sleep.kpi.minutesValue', '{{value}} min', {
                        value: fmtNumber(
                          analysis.dwell.timeToSleepAvgMin,
                        ),
                      })
                    : '—'
                }
                color="cyan"
                subtitle={
                  analysis.dwell.timeToSleepAvgMin != null
                    ? t(
                        'sleep.kpi.reportedEvidence',
                        'Positive finite response value',
                      )
                    : t(
                        'sleep.kpi.placeholderWithheld',
                        'Placeholder zero withheld',
                      )
                }
              />
              <MetricCard
                icon={<Eye className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.sentryAvailability',
                  'Sentry comparison',
                )}
                value={hasResponse ? sentryAvailability : '—'}
                color="amber"
                subtitle={t(
                  'sleep.kpi.sentrySamples',
                  'Requires positive sample counts',
                )}
              />
              <MetricCard
                icon={<Database className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.kpi.evidenceBreadth',
                  'Evidence breadth',
                )}
                value={
                  hasResponse
                    ? t('sleep.kpi.breadthValue', '{{score}} / 100', {
                        score: fmtInt(analysis.breadth.score),
                      })
                    : '—'
                }
                color="red"
                subtitle={t(
                  'sleep.kpi.breadthNotConfidence',
                  'Source support score; not confidence',
                )}
              />
            </div>

            {!state.vehicleSelected && (
              <AlertBanner className="mt-4" variant="info">
                {t(
                  'sleep.states.noVehicle',
                  'Select a vehicle to load its sleep evidence.',
                )}
              </AlertBanner>
            )}
          </>
        )}
      </GlassPanel>
    </section>
  );
}
