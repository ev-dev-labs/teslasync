import {
  Battery,
  Clock,
  Eye,
  ListChecks,
  Percent,
  Thermometer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function DrainEventProfile({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const aggregates = analysis.events.aggregates;

  return (
    <section data-testid="sleep-efficiency-event-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('sleep.eventProfile.title', 'Drain-event profile')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.eventProfile.subtitle',
            'Aggregates use every validated event; the capped directory below does not change these summaries.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state}>
          {aggregates.available ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
                label={t('sleep.eventProfile.count', 'Validated events')}
                value={fmtInt(aggregates.count)}
                color="cyan"
              />
              <MetricCard
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.eventProfile.duration',
                  'Total / median duration',
                )}
                value={
                  aggregates.totalDurationHours != null
                  && aggregates.medianDurationHours != null
                    ? t(
                        'sleep.eventProfile.durationValue',
                        '{{total}} h / {{median}} h',
                        {
                          total: fmtNumber(
                            aggregates.totalDurationHours,
                          ),
                          median: fmtNumber(
                            aggregates.medianDurationHours,
                          ),
                        },
                      )
                    : '—'
                }
                color="blue"
              />
              <MetricCard
                icon={<Battery className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.eventProfile.batteryLoss',
                  'Total battery loss',
                )}
                value={
                  aggregates.totalBatteryLost != null
                    ? t(
                        'sleep.eventProfile.percentValue',
                        '{{value}}%',
                        {
                          value: fmtNumber(
                            aggregates.totalBatteryLost,
                          ),
                        },
                      )
                    : '—'
                }
                color="red"
              />
              <MetricCard
                icon={<Percent className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.eventProfile.medianDrain',
                  'Median drain rate',
                )}
                value={
                  aggregates.medianDrainRate != null
                    ? t(
                        'sleep.eventProfile.rateValue',
                        '{{value}}%/hr',
                        {
                          value: fmtNumber(
                            aggregates.medianDrainRate,
                          ),
                        },
                      )
                    : '—'
                }
                color="purple"
              />
              <MetricCard
                icon={<Eye className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.eventProfile.sentryShare',
                  'Sentry event share',
                )}
                value={
                  aggregates.sentryShare != null
                    ? t(
                        'sleep.eventProfile.percentValue',
                        '{{value}}%',
                        {
                          value: fmtNumber(
                            aggregates.sentryShare * 100,
                          ),
                        },
                      )
                    : '—'
                }
                color="amber"
              />
              <MetricCard
                icon={<Thermometer className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.eventProfile.temperatureCoverage',
                  'Temperature coverage',
                )}
                value={
                  aggregates.temperatureCoverage != null
                    ? t(
                        'sleep.eventProfile.percentValue',
                        '{{value}}%',
                        {
                          value: fmtNumber(
                            aggregates.temperatureCoverage * 100,
                          ),
                        },
                      )
                    : '—'
                }
                color="green"
              />
            </div>
          ) : (
            // no-action: aggregates appear automatically when validated events are returned
            <EmptyState
              className="py-8"
              icon={<ListChecks className="h-8 w-8" aria-hidden="true" />}
              title={t(
                'sleep.eventProfile.unavailableTitle',
                'Drain-event aggregates unavailable',
              )}
              message={t(
                'sleep.eventProfile.unavailable',
                'No validated drain events are available. Placeholder total_events and average-duration zeros are not treated as observations.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
