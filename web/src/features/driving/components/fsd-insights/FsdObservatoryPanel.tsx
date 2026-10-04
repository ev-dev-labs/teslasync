import { useTranslation } from 'react-i18next';
import { AlertTriangle, BookOpen, History, Route } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { safeArray } from '@/lib/safeArray';

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
}

const KPI_COLUMNS = { default: 1, sm: 2, xl: 4 } as const;

/**
 * Reset-safe journal of reported FSD kilometres. Unknown and ambiguous
 * distance stay first-class. This is not an engagement map.
 */
export function FsdObservatoryPanel({ insights, state }: FsdObservatoryPanelProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const observatory = insights?.drive_analytics?.observatory;
  const totals = observatory?.totals;
  const timeline = safeArray(observatory?.timeline);
  const stories = safeArray(observatory?.commute_stories);
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
                : formatDistance(totals.stitched_fsd_distance_m)}
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
                : formatDistance(totals.ambiguous_fsd_distance_m)}
              subtitle={t(
                'fsd.observatory.ambiguousHint',
                'Counter increased across overlapping drives',
              )}
            />
            <MetricCard
              wrapLabel
              label={t('fsd.observatory.unknown', 'Unknown drive distance')}
              value={formatDistance(totals?.unknown_drive_distance_m ?? null)}
              subtitle={t(
                'fsd.observatory.unknownHint',
                '{{count}} drives with no measured FSD',
                { count: totals?.unknown_drive_count ?? 0 },
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
        </FsdSectionBody>
      </GlassPanel>
    </section>
  );
}
