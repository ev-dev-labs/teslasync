import { useTranslation } from 'react-i18next';
import { BookOpen, History } from 'lucide-react';

import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { deriveDataState, type DataState } from '@/api/dataState';
import { DataProvenanceBadge } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { safeArray } from '@/lib/safeArray';
import { neonColorMap, typography } from '@/lib/tokens';

import type {
  FsdInsights,
} from '@/types/fsd';

import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';
import { FsdObservatoryJournalTable } from './FsdObservatoryJournalTable';
import { FsdCommuteStoriesTable } from './FsdCommuteStoriesTable';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface FsdObservatoryPanelProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
  dataState?: DataState<FsdInsights>;
}

/**
 * Reset-safe journal of reported FSD kilometres. Unknown and ambiguous
 * distance stay first-class. This is not an engagement map.
 */
export function FsdObservatoryPanel({ insights, state, dataState }: FsdObservatoryPanelProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const source = dataState ?? deriveDataState({
    data: insights,
    error: state.error,
    isLoading: state.isLoading,
    refetch: state.onRetry,
  }, { provenance: 'historical' });
  const data = source.data;
  const retained = source.hasData && (source.status === 'stale'
    || source.status === 'partial' || source.isRefreshing || source.isRefreshBlocked);
  const bodyState: FsdSectionState = {
    ...state,
    isLoading: !source.hasData && source.status === 'initial' && !source.isRefreshBlocked,
    error: source.hasData ? null : source.fatalError,
    onRetry: source.retry ?? state.onRetry,
  };
  const observatory = data?.drive_analytics?.observatory;
  const totals = observatory?.totals;
  const timeline = safeArray(observatory?.timeline);
  const stories = safeArray(observatory?.commute_stories);
  const honesty = observatory?.honesty
    ?? t(
      'fsd.observatory.honesty',
      'Every kilometre here is a reset-safe counter change, not an FSD engagement segment. Unknown and ambiguous distance are shown instead of guessed.',
    );
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'stitched-fsd', rawValue: totals?.stitched_fsd_distance_m,
      label: t('fsd.observatory.stitched', 'Stitched reported FSD'),
      description: totals?.stitched_fsd_distance_m == null
        ? t('fsd.observatory.stitchedUnavailable', 'No high-confidence or estimated counter change in this period')
        : t('fsd.observatory.stitchedHint', 'High and estimated only; resets add no kilometres'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'ambiguous-fsd', rawValue: totals?.ambiguous_fsd_distance_m,
      label: t('fsd.observatory.ambiguous', 'Ambiguous FSD'),
      description: t('fsd.observatory.ambiguousHint', 'Counter increased across overlapping drives'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'unknown-drive-distance', rawValue: totals?.unknown_drive_distance_m,
      label: t('fsd.observatory.unknown', 'Unknown drive distance'),
      description: totals == null ? t('fsd.notMeasured', 'Not measured')
        : t('fsd.observatory.unknownHint', '{{count}} drives with no measured FSD', { count: totals.unknown_drive_count }),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'counter-resets', rawValue: totals?.reset_break_count,
      label: t('fsd.observatory.resets', 'Counter resets'),
      description: t('fsd.observatory.resetsHint', 'Each reset is a break in the stitch, not travelled FSD'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
  ];

  return (
    <section
      aria-label={t('fsd.observatory.section', 'FSD observatory')}
      data-testid="fsd-observatory"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <History className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
          {t('fsd.observatory.title', 'FSD observatory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {honesty}
        </Text>
        <FsdSectionBody state={bodyState} className="min-h-28">
          {!source.hasData && source.isRefreshBlocked ? (
            <Text as="p" variant="bodySm" role="status">
              {t('dataSources.status.paused', 'Refresh paused')}
            </Text>
          ) : <>
          <StaleRefreshWarning state={source} label={t('fsd.observatory.title', 'FSD observatory')} />
          <DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />
          <NestedDrivingBrief metrics={metrics}
            title={t('fsd.brief.observatoryMetrics', 'Reset-safe counter quantities')}
            description={honesty} loading={bodyState.isLoading} retained={retained}
            unavailable={!source.hasData || source.status === 'unavailable'}
            period={{ kind: 'unknown',
              label: data ? `${data.period.start_at} – ${data.period.end_at} · ${data.period.timezone}` : t('fsd.notMeasured', 'Not measured'),
              reason: honesty }} />

          <div className="mt-6">
            <Text as="h3" size="sm" weight="semibold" className="mb-2">
              {t('fsd.observatory.timeline', 'Stitched journal')}
            </Text>
            {observatory?.truncated ? (
              <Text as="p" variant="caption" className={`mb-2 ${neonColorMap.amber.text}`}>
                {t(
                  'fsd.observatory.truncated',
                  'Oldest drives were omitted so every counter reset still appears.',
                )}
              </Text>
            ) : null}
            {timeline.length > 0 ? (
              <FsdObservatoryJournalTable events={timeline} />
            ) : (
              <EmptyState /* no-action: informational empty — no CTA */
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
              <BookOpen className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
              {t('fsd.observatory.commute', 'Commute stories')}
            </Text>
            <Text as="p" variant="caption" className="mb-3">
              {t(
                'fsd.observatory.commuteHint',
                'Repeated routes told across firmware. Unknown chapters stay unknown.',
              )}
            </Text>
            {stories.length > 0 ? (
              <>
                <Text as="p" variant="caption" className="mb-3">
                  {t('fsd.observatory.chaptersHint', 'One row per route and firmware chapter. Route drives is the route total; chapter drives is the count for that firmware chapter.')}
                </Text>
                <FsdCommuteStoriesTable stories={stories} />
              </>
            ) : (
              <Text as="p" variant="caption">
                {t(
                  'fsd.observatory.commuteEmpty',
                  'Not enough repeated routes yet for a commute story.',
                )}
              </Text>
            )}
          </div>
          </>}
        </FsdSectionBody>
      </GlassPanel>
    </section>
  );
}
