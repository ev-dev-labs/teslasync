import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BookOpen, History, Route } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type {
  FsdAttributionConfidence,
  FsdInsights,
  FsdObservatoryEvent,
} from '@/types/fsd';

import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';

interface FsdObservatoryPanelProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

const KPI_COLUMNS = { default: 1, sm: 2, xl: 4 } as const;

const confidenceVariant: Record<
  FsdAttributionConfidence,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  high: 'success',
  estimated: 'info',
  ambiguous: 'warning',
  unknown: 'neutral',
};

/**
 * Reset-safe journal of reported FSD kilometres. Unknown and ambiguous
 * distance stay first-class. This is not an engagement map.
 */
export function FsdObservatoryPanel({ insights, state }: FsdObservatoryPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const observatory = insights?.drive_analytics?.observatory;
  const totals = observatory?.totals;
  const timeline = observatory?.timeline ?? [];
  const stories = observatory?.commute_stories ?? [];
  const honesty = observatory?.honesty
    ?? t(
      'fsd.observatory.honesty',
      'Every kilometre here is a reset-safe counter change, not an FSD engagement segment. Unknown and ambiguous distance are shown instead of guessed.',
    );

  return (
    <section
      aria-label={t('fsd.observatory.section', 'FSD observatory')}
      data-testid="fsd-observatory"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('fsd.observatory.title', 'FSD observatory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {honesty}
        </Text>
        <FsdSectionBody state={state} className="min-h-28">
          <Grid cols={KPI_COLUMNS} gap={4}>
            <MetricCard
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
              wrapLabel
              label={t('fsd.observatory.stitched', 'Stitched reported FSD')}
              value={totals?.stitched_fsd_distance_m == null
                ? '—'
                : formatDistance(totals.stitched_fsd_distance_m, { precision: 1 })}
              subtitle={
                totals?.stitched_fsd_distance_m == null
                  ? t(
                      'fsd.observatory.stitchedUnavailable',
                      'No high-confidence or estimated counter change in this period',
                    )
                  : t(
                      'fsd.observatory.stitchedHint',
                      'High and estimated only; resets add no kilometres',
                    )
              }
            />
            <MetricCard
              icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
              color="purple"
              wrapLabel
              label={t('fsd.observatory.ambiguous', 'Ambiguous FSD')}
              value={totals?.ambiguous_fsd_distance_m == null
                ? '—'
                : formatDistance(totals.ambiguous_fsd_distance_m, { precision: 1 })}
              subtitle={t(
                'fsd.observatory.ambiguousHint',
                'Counter increased across overlapping drives',
              )}
            />
            <MetricCard
              wrapLabel
              label={t('fsd.observatory.unknown', 'Unknown drive distance')}
              value={formatDistance(totals?.unknown_drive_distance_m ?? null, { precision: 1 })}
              subtitle={t(
                'fsd.observatory.unknownHint',
                '{{count}} drives with no measured FSD',
                { count: fmtInt(totals?.unknown_drive_count ?? 0) },
              )}
            />
            <MetricCard
              wrapLabel
              label={t('fsd.observatory.resets', 'Counter resets')}
              value={fmtInt(totals?.reset_break_count ?? 0)}
              subtitle={t(
                'fsd.observatory.resetsHint',
                'Each reset is a break in the stitch, not travelled FSD',
              )}
            />
          </Grid>

          <div className="mt-6">
            <Text as="h3" size="sm" weight="semibold" className="mb-2">
              {t('fsd.observatory.timeline', 'Stitched journal')}
            </Text>
            {observatory?.truncated ? (
              <Text as="p" variant="caption" className="mb-2">
                {t(
                  'fsd.observatory.truncated',
                  'Oldest drives were omitted so every counter reset still appears.',
                )}
              </Text>
            ) : null}
            {timeline.length > 0 ? (
              <ol className="space-y-2" data-testid="fsd-observatory-timeline">
                {timeline.map((event) => (
                  <ObservatoryEventRow
                    key={eventKey(event)}
                    event={event}
                    formatDistance={formatDistance}
                  />
                ))}
              </ol>
            ) : (
              <EmptyState
                icon={<History className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'fsd.observatory.timelineEmpty',
                  'No completed drives in this period to journal.',
                )}
              />
            )}
          </div>

          <div className="mt-6">
            <Text as="h3" size="sm" weight="semibold" className="mb-1 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('fsd.observatory.commute', 'Commute stories')}
            </Text>
            <Text as="p" variant="caption" className="mb-3">
              {t(
                'fsd.observatory.commuteHint',
                'Repeated routes told across firmware. Unknown chapters stay unknown.',
              )}
            </Text>
            {stories.length > 0 ? (
              <ul className="space-y-3" data-testid="fsd-observatory-commute">
                {stories.map((story) => (
                  <li
                    key={story.route_key}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3"
                  >
                    <Text as="div" weight="semibold">
                      {story.route_label}
                    </Text>
                    <Text as="div" size="xs" color="muted" className="mb-2">
                      {t('fsd.observatory.driveCount', '{{count}} drives', {
                        count: fmtInt(story.drive_count),
                      })}
                    </Text>
                    <ol className="space-y-2">
                      {story.chapters.map((chapter, index) => (
                        <li key={`${story.route_key}-${index}`} className="text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="info" size="sm">
                              {chapter.firmware_version
                                ?? t('fsd.observatory.unknownFirmware', 'Unknown firmware')}
                            </Badge>
                            <span className="tabular-nums">
                              {chapter.fsd_distance_m == null
                                ? t('fsd.notMeasured', 'Not measured')
                                : formatDistance(chapter.fsd_distance_m, { precision: 1 })}
                            </span>
                            {chapter.fsd_share_pct != null ? (
                              <Text as="span" color="muted">
                                {t('fsd.kpi.sharePct', '{{value}}%', {
                                  value: fmtNumber(chapter.fsd_share_pct, 1),
                                })}
                              </Text>
                            ) : null}
                            {chapter.unknown_count > 0 ? (
                              <Badge variant="neutral" size="sm">
                                {t('fsd.observatory.unknownDrives', '{{count}} unknown', {
                                  count: fmtInt(chapter.unknown_count),
                                })}
                              </Badge>
                            ) : null}
                            {chapter.ambiguous_count > 0 ? (
                              <Badge variant="warning" size="sm">
                                {t('fsd.observatory.ambiguousDrives', '{{count}} ambiguous', {
                                  count: fmtInt(chapter.ambiguous_count),
                                })}
                              </Badge>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            ) : (
              <Text as="p" variant="caption">
                {t(
                  'fsd.observatory.commuteEmpty',
                  'Not enough repeated routes yet for a commute story.',
                )}
              </Text>
            )}
          </div>
        </FsdSectionBody>
      </GlassPanel>
    </section>
  );
}

function eventKey(event: FsdObservatoryEvent): string {
  return [
    event.kind,
    event.at,
    event.drive_id ?? '',
    event.field ?? '',
  ].join(':');
}

function ObservatoryEventRow({
  event,
  formatDistance,
}: {
  event: FsdObservatoryEvent;
  formatDistance: (meters: number | null, options?: { precision?: number }) => string;
}) {
  const { t } = useTranslation();
  if (event.kind === 'reset') {
    return (
      <li
        data-testid="fsd-observatory-reset"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm"
      >
        <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
        <Text as="span" weight="medium">{formatDateTime(event.at)}</Text>
        <Badge variant="warning" size="sm">
          {t('fsd.observatory.resetBadge', 'Counter reset')}
        </Badge>
        <Text as="span" color="muted">
          {t(
            'fsd.observatory.resetHint',
            'Break in the stitch — not travelled FSD{{field}}.',
            { field: event.field ? ` (${event.field})` : '' },
          )}
        </Text>
      </li>
    );
  }

  const confidence = event.confidence ?? 'unknown';
  const fsdLabel = event.fsd_distance_m == null
    ? t('fsd.notMeasured', 'Not measured')
    : `${confidence === 'high' ? '' : '~'}${formatDistance(event.fsd_distance_m, { precision: 1 })}`;

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3 text-sm">
      {event.drive_id != null ? (
        <Link
          to={`/drives/${event.drive_id}`}
          className="font-medium text-cyan-300 hover:text-cyan-200"
        >
          {formatDateTime(event.at)}
        </Link>
      ) : (
        <Text as="span" weight="medium">{formatDateTime(event.at)}</Text>
      )}
      <Text as="span" color="muted">
        {event.route_label
          ?? t('fsd.observatory.unlabelledRoute', 'Unlabelled route')}
      </Text>
      <span className="tabular-nums" data-testid="fsd-observatory-drive-fsd">
        {fsdLabel}
      </span>
      <Badge variant={confidenceVariant[confidence]} size="sm">
        {confidence === 'high'
          ? t('fsd.drive.confidence.high', 'High')
          : confidence === 'estimated'
            ? t('fsd.drive.confidence.estimated', 'Estimated')
            : confidence === 'ambiguous'
              ? t('fsd.drive.confidence.ambiguous', 'Ambiguous')
              : t('fsd.drive.confidence.unknown', 'Unknown')}
      </Badge>
      {event.approximate ? (
        <Text as="span" size="xs" color="muted">
          {t('fsd.observatory.approximate', 'Approximate counter increase')}
        </Text>
      ) : null}
      {event.firmware_version ? (
        <Text as="span" size="xs" color="muted">{event.firmware_version}</Text>
      ) : null}
    </li>
  );
}
