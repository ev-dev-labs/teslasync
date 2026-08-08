import {
  CalendarDays,
  CalendarRange,
  Clock3,
  Database,
  Gauge,
  Rows3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { PackCapacityResult } from '../../lib/packCapacity';
import {
  packCapacityNumber,
  packCapacityPercent,
} from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityCoverageProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
}

export function PackCapacityCoverage({
  result,
  state,
  locale,
}: PackCapacityCoverageProps) {
  const { t } = useTranslation();
  const coverage = result.coverage;
  const resolved = state.isResolved && !state.error;

  return (
    <section data-testid="pack-capacity-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.coverage.title',
            'Coverage, cadence, and recency',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.coverage.subtitle',
            'How much returned charging evidence supports the displayed estimates and how it is distributed through time.',
          )}
        </Text>
        <PackCapacitySectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t(
                'packCapacity.coverage.returned',
                'Rows returned',
              )}
              value={
                resolved
                  ? packCapacityNumber(
                      result.accounting.returnedRows,
                      locale,
                      0,
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.historyLimit',
                'maximum {{limit}} rows requested',
                { limit: result.config.historyLimit },
              )}
              icon={<Rows3 className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'packCapacity.coverage.qualified',
                'Qualified share',
              )}
              value={
                resolved
                  ? packCapacityPercent(
                      coverage.qualifiedShare,
                      locale,
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.qualifiedCount',
                '{{count}} measurements',
                { count: result.observations.length },
              )}
              icon={<Gauge className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t('packCapacity.coverage.span', 'Evidence span')}
              value={
                resolved
                  ? t(
                      'packCapacity.coverage.days',
                      '{{value}} days',
                      {
                        value: packCapacityNumber(
                          coverage.observedSpanDays,
                          locale,
                          0,
                        ),
                      },
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.firstToLast',
                'first to latest qualified completion',
              )}
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t('packCapacity.coverage.activeWeeks', 'Active weeks')}
              value={
                resolved
                  ? packCapacityNumber(
                      coverage.activeLocalWeeks,
                      locale,
                      0,
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.activeDays',
                '{{count}} active local days',
                { count: coverage.activeLocalDays },
              )}
              icon={<CalendarDays className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'packCapacity.coverage.cadence',
                'Median cadence',
              )}
              value={
                resolved && coverage.medianCadenceDays != null
                  ? t(
                      'packCapacity.coverage.days',
                      '{{value}} days',
                      {
                        value: packCapacityNumber(
                          coverage.medianCadenceDays,
                          locale,
                          1,
                        ),
                      },
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.betweenSamples',
                'between qualified completions',
              )}
              icon={<Clock3 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t('packCapacity.coverage.recency', 'Recency')}
              value={
                resolved && coverage.daysSinceLastObservation != null
                  ? t(
                      'packCapacity.coverage.days',
                      '{{value}} days',
                      {
                        value: packCapacityNumber(
                          coverage.daysSinceLastObservation,
                          locale,
                          1,
                        ),
                      },
                    )
                  : '—'
              }
              subtitle={t(
                'packCapacity.coverage.frozenClock',
                'to frozen analysis clock',
              )}
              icon={<Database className="h-5 w-5" />}
              color="red"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'packCapacity.coverage.capDisclosure',
                'Timeline display omits {{timeline}} older plotted points and the directory omits {{directory}} older qualified measurements. Summary calculations still use every included row inside the {{limit}}-row analysis cap.',
                {
                  timeline: coverage.omittedTimelinePoints,
                  directory: coverage.omittedRecentMeasurements,
                  limit: result.config.historyLimit,
                },
              )}
            </Text>
          </AlertBanner>
        </PackCapacitySectionBody>
      </GlassPanel>
    </section>
  );
}
