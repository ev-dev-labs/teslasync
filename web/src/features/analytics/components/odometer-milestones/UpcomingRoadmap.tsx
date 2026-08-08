import { CalendarClock, Milestone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

interface UpcomingRoadmapProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
  className?: string;
}

export function UpcomingRoadmap({
  summary,
  state,
  className,
}: UpcomingRoadmapProps) {
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } =
    useOdometerMilestoneDisplay();

  return (
    <section
      className={className}
      aria-label={t(
        'milestones.sections.roadmap',
        'Upcoming milestone roadmap',
      )}
      data-testid="milestone-roadmap"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Milestone className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('milestones.roadmap.title', 'Upcoming milestone roadmap')}
        </PanelTitle>
        <MilestoneSectionBody state={state}>
          <ul className="space-y-2">
            {summary.upcoming.map((milestone) => {
              const forecast = milestone.forecast;
              const hasRange =
                forecast != null &&
                forecast.scenarioCount > 1 &&
                formatDateMs(forecast.rangeStartMs) !==
                  formatDateMs(forecast.rangeEndMs);
              return (
                <li
                  key={milestone.thresholdKm}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="info">
                        {formatDistanceKm(milestone.thresholdKm)}
                      </Badge>
                      <Text variant="bodySm">
                        {t(
                          'milestones.roadmap.remaining',
                          '{{distance}} remaining',
                          {
                            distance: formatDistanceKm(
                              milestone.remainingKm,
                            ),
                          },
                        )}
                      </Text>
                    </div>
                    <div className="text-right">
                      <Text size="sm" mono className="tabular-nums">
                        {forecast
                          ? formatDateMs(forecast.etaMs)
                          : summary.primaryPace.supported
                            ? t(
                                'milestones.roadmap.outOfRange',
                                'Beyond forecast horizon',
                              )
                            : t(
                                'milestones.roadmap.noEta',
                                'Projection unavailable',
                              )}
                      </Text>
                      {hasRange ? (
                        <Text variant="caption">
                          {t(
                            'milestones.roadmap.range',
                            'Scenario range {{from}}–{{to}}',
                            {
                              from: formatDateMs(forecast.rangeStartMs),
                              to: formatDateMs(forecast.rangeEndMs),
                            },
                          )}
                        </Text>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex gap-2 rounded-lg bg-white/[0.025] p-3">
            <CalendarClock
              className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
              aria-hidden="true"
            />
            <Text variant="caption">
              {t(
                'milestones.roadmap.caveat',
                'Dates use the supported trailing-90-day pace. They are projections, not guarantees.',
              )}
            </Text>
          </div>
        </MilestoneSectionBody>
      </GlassPanel>
    </section>
  );
}
