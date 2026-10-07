import { MapPinned, Medal, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dateFormat';

import type { ExplorerSummary } from '../../lib/explorer';
import { ExplorerSectionBody } from './ExplorerSectionBody';
import type { ExplorerDistanceDisplay, ExplorerSectionState } from './types';

interface DestinationRankingsProps extends ExplorerDistanceDisplay {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function DestinationRankings({
  summary,
  state,
  formatDistance,
  className,
}: DestinationRankingsProps) {
  const { t } = useTranslation();

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.rankings',
        'Farthest and rarely observed destination rankings',
      )}
      data-testid="explorer-rankings"
    >
      <GlassPanel className={cn('h-full p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <Medal className="h-4 w-4 text-purple-300" aria-hidden="true" />
            {t('explorer.rankings.title', 'Destination rankings')}
          </PanelTitle>
          <Badge
            variant={summary.evidence.rankingSufficient ? 'success' : 'warning'}
            dot
          >
            {summary.evidence.rankingSufficient
              ? t('explorer.rankings.ready', 'Comparison ready')
              : t(
                  'explorer.rankings.building',
                  'Two destinations required',
                )}
          </Badge>
        </div>

        <ExplorerSectionBody state={state} className="mt-4 min-h-72">
          {!summary.evidence.rankingSufficient ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<MapPinned className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'explorer.rankings.empty',
                'A repeated inferred base and at least two destinations are required for comparative rankings.',
              )}
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <Text as="p" variant="label" className="mb-1">
                  {t('explorer.rankings.farthest', 'Farthest observed')}
                </Text>
                <Text as="p" variant="caption" className="mb-3">
                  {t(
                    'explorer.rankings.farthestHint',
                    'Great-circle distance from the inferred observed base',
                  )}
                </Text>
                <ol className="space-y-2">
                  {summary.farthestRanking.map((destination, index) => (
                    <li
                      key={destination.id}
                      className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] p-3"
                    >
                      <Text
                        as="span"
                        variant="label"
                        mono
                        className="shrink-0 text-cyan-300"
                      >
                        {index + 1}
                      </Text>
                      <div className="min-w-0 flex-1">
                        <Text
                          as="p"
                          variant="bodySm"
                          className="truncate"
                        >
                          {destination.label ??
                            t(
                              'explorer.destination.unnamed',
                              'Unnamed destination {{number}}',
                              { number: destination.ordinal },
                            )}
                        </Text>
                        <Text as="p" variant="caption">
                          {t(
                            'explorer.rankings.distanceVisits',
                            '{{distance}} · {{count}} arrivals',
                            {
                              distance: formatDistance(
                                destination.distanceFromBaseM,
                                { precision: 0 },
                              ),
                              count: destination.visits,
                            },
                          )}
                        </Text>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <Text as="p" variant="label" className="mb-1">
                  {t('explorer.rankings.rare', 'Rare destinations')}
                </Text>
                <Text as="p" variant="caption" className="mb-3">
                  {t(
                    'explorer.rankings.rareHint',
                    'One or two arrivals, then farthest first within each visit count',
                  )}
                </Text>
                {summary.rareRanking.length === 0 ? (
                  <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
                    className="py-8"
                    icon={<Pin className="h-7 w-7" aria-hidden="true" />}
                    message={t(
                      'explorer.rankings.noRare',
                      'Every ranked destination has more than two arrivals.',
                    )}
                  />
                ) : (
                  <ol className="space-y-2">
                    {summary.rareRanking.map((destination, index) => (
                      <li
                        key={destination.id}
                        className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] p-3"
                      >
                        <Text
                          as="span"
                          variant="label"
                          mono
                          className="shrink-0 text-amber-300"
                        >
                          {index + 1}
                        </Text>
                        <div className="min-w-0 flex-1">
                          <Text
                            as="p"
                            variant="bodySm"
                            className="truncate"
                          >
                            {destination.label ??
                              t(
                                'explorer.destination.unnamed',
                                'Unnamed destination {{number}}',
                                { number: destination.ordinal },
                              )}
                          </Text>
                          <Text as="p" variant="caption">
                            {t(
                              'explorer.rankings.rareDetail',
                              '{{count}} arrivals · first observed {{date}}',
                              {
                                count: destination.visits,
                                date: formatDate(destination.firstVisitedAt),
                              },
                            )}
                          </Text>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </ExplorerSectionBody>
      </GlassPanel>
    </section>
  );
}
