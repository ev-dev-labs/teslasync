import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';
import { UtilizationSectionBody } from './UtilizationSectionBody';

interface BusiestDaysProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function BusiestDays({
  summary,
  state,
}: BusiestDaysProps) {
  const { t } = useTranslation();
  const {
    formatDay,
    formatDistance,
    formatDuration,
    formatEnergy,
  } = useUtilizationDisplay();
  const guard = summary.sampleGuards.busiestDays;

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      role="region"
      aria-label={t(
        'utilization.sections.busiest',
        'Ranked busiest observed days',
      )}
      data-testid="utilization-busiest"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <Flame
              className="h-4 w-4 text-cyan-300"
              aria-hidden="true"
            />
            {t(
              'utilization.busiest.title',
              'Busiest observed days',
            )}
          </PanelTitle>
          <Text variant="caption" as="p">
            {t(
              'utilization.busiest.subtitle',
              'Ranked by logged driving time, then distance, drive count, and date.',
            )}
          </Text>
        </div>
        <Badge variant={guard.sufficient ? 'success' : 'warning'} dot>
          {guard.sufficient
            ? t(
                'utilization.sample.supported',
                '{{count}} observations',
                { count: guard.sampleSize },
              )
            : t(
                'utilization.sample.limited',
                'Limited sample: {{count}} of {{minimum}}',
                {
                  count: guard.sampleSize,
                  minimum: guard.minimum,
                },
              )}
        </Badge>
      </div>

      <UtilizationSectionBody state={state} className="mt-4 min-h-64">
        {summary.busiestDays.length === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            icon={<Flame className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'utilization.busiest.empty',
              'No active observed days are available to rank.',
            )}
          />
        ) : (
          <ol className="space-y-3">
            {summary.busiestDays.map((day, index) => (
              <li
                key={day.day}
                className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:grid-cols-[auto_minmax(10rem,1fr)_repeat(4,minmax(5rem,auto))] sm:items-center"
              >
                <Badge variant="neutral">
                  {t(
                    'utilization.busiest.rank',
                    '#{{rank}}',
                    { rank: index + 1 },
                  )}
                </Badge>
                <Text
                  size="sm"
                  weight="semibold"
                  color="primary"
                >
                  {formatDay(day.day)}
                </Text>
                <div>
                  <MetricLabel>
                    {t(
                      'utilization.busiest.drivingTime',
                      'Driving time',
                    )}
                  </MetricLabel>
                  <Text variant="bodySm" mono>
                    {formatDuration(day.drivingS)}
                  </Text>
                </div>
                <div>
                  <MetricLabel>
                    {t(
                      'utilization.busiest.distance',
                      'Distance',
                    )}
                  </MetricLabel>
                  <Text variant="bodySm" mono>
                    {formatDistance(day.distanceM, {
                      precision: 1,
                    })}
                  </Text>
                </div>
                <div>
                  <MetricLabel>
                    {t('utilization.busiest.drives', 'Drives')}
                  </MetricLabel>
                  <Text variant="bodySm" mono>
                    {fmtInt(day.driveCount)}
                  </Text>
                </div>
                <div>
                  <MetricLabel>
                    {t('utilization.busiest.energy', 'Energy')}
                  </MetricLabel>
                  <Text variant="bodySm" mono>
                    {day.energyWh > 0
                      ? formatEnergy(day.energyWh, {
                          precision: 1,
                        })
                      : '—'}
                  </Text>
                </div>
              </li>
            ))}
          </ol>
        )}
      </UtilizationSectionBody>
    </GlassPanel>
  );
}
