import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useJourneyLive,
  type JourneyRangeVerdict,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { useQueuedCheckIn } from '../hooks/useQueuedCheckIn';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, Button, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { LayoutCard, SourceContent } from '@/components/layout';
import { EmptyState, ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';
import { formatTime } from '@/lib/dateFormat';
import { safeArray } from '@/lib/safeArray';

const VERDICT_LABEL_KEYS: Record<JourneyRangeVerdict, string> = {
  ok: 'journey.live.verdict.ok',
  attention: 'journey.live.verdict.attention',
  action: 'journey.live.verdict.action',
  unknown: 'journey.live.verdict.unknown',
};

const VERDICT_DEFAULTS: Record<JourneyRangeVerdict, string> = {
  ok: 'On energy',
  attention: 'Tight',
  action: 'Charge soon',
  unknown: 'Unknown',
};

function verdictVariant(verdict: JourneyRangeVerdict) {
  switch (verdict) {
    case 'ok':
      return 'success' as const;
    case 'attention':
      return 'warning' as const;
    case 'action':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Live trip session: glanceable progress, range verdict, next stop,
 * and the trail behind. The backend polls vehicle state on a 15 s
 * ambient tick; "Check in" drops an explicit trail point on demand —
 * queued offline and replayed on reconnect.
 */
export function LiveTripPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const units = useUnits();

  const liveQuery = useJourneyLive(session.id);
  const liveState = useDataState(liveQuery);
  const view = liveQuery.data ?? null;
  const trail = safeArray(view?.trail);
  const liveEvidence = safeArray(view?.evidence);

  const { checkIn, queued, isPending: checkInPending } = useQueuedCheckIn(session.id);
  const busy = liveQuery.isLoading || checkInPending;
  const emptyTrip = (
    <EmptyState
      icon={<Icons.navigation className="h-10 w-10" aria-hidden="true" />}
      message={t('journey.live.empty', 'No fixes yet. Check in to drop the first trail point.')}
      action={{ label: t('journey.live.checkIn', 'Check in'), onClick: checkIn }}
    />
  );

  const pct =
    view?.progress != null && view.progress.total_m > 0
      ? Math.min(100, Math.max(0, (view.progress.done_m / view.progress.total_m) * 100))
      : null;

  return (
    <LayoutCard
      title={t('journey.live.title', 'Live trip')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {queued > 0 ? (
            <Text as="p" variant="caption" className="tabular-nums">
              {t('journey.live.queued', '{{count}} queued', { count: queued })}
            </Text>
          ) : null}
          {view?.latest != null ? (
            <Button
              wrapLabel
              variant="secondary"
              size="sm"
              loading={checkInPending}
              onClick={checkIn}
            >
              {t('journey.live.checkIn', 'Check in')}
            </Button>
          ) : null}
        </div>
      }
    >
      <SourceContent
        state={busy && view?.latest == null ? 'loading' : liveState.fatalError ? 'error'
          : liveState.status === 'stale' ? 'retained' : view?.latest == null ? 'empty' : 'ready'}
        label={t('journey.live.title', 'Live trip')}
        emptyMessage={t('journey.live.empty', 'No fixes yet. Check in to drop the first trail point.')}
        errorMessage={t('journey.live.loadFailed', 'The live trip could not be loaded.')}
        error={liveState.fatalError}
        errorRecovery={{ onRetry: liveState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.live.loading', 'Loading live trip…')} />}
        emptyContent={emptyTrip}
      >
      {view?.latest != null ? (
        <div className="space-y-3">
          {pct != null && view.progress != null ? (
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <Text as="p" variant="label">
                  {t('journey.live.progress', 'Progress')}
                </Text>
                <Text as="p" variant="caption" className="tabular-nums">
                  {units.formatDistance(view.progress.left_m)}{' '}
                  {t('journey.live.remaining', 'remaining')}
                </Text>
              </div>
              <MetricBar
                value={pct}
                max={100}
                color="var(--color-emerald-500, #10b981)"
                fill="solid"
                showHeader={false}
                ariaLabel={t('journey.live.progress', 'Progress')}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Text as="p" variant="label">
              {t('journey.live.range', 'Range')}
            </Text>
            <Badge variant={verdictVariant(view.range.verdict)}>
              {t(VERDICT_LABEL_KEYS[view.range.verdict], VERDICT_DEFAULTS[view.range.verdict])}
            </Badge>
            {view.range.have_wh != null && view.range.need_wh != null ? (
              <Text as="p" variant="caption" className="tabular-nums">
                {units.formatEnergy(view.range.have_wh)}{' '}
                {t('journey.live.have', 'have')} · {units.formatEnergy(view.range.need_wh)}{' '}
                {t('journey.live.need', 'need')}
              </Text>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Icons.flag className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Text as="p" variant="label">
              {t('journey.live.nextStop', 'Next stop')}
            </Text>
            {view.next != null ? (
              <Text as="p" size="sm">
                {view.next.site}
                {view.next.wait_s != null ? (
                  <Text as="span" variant="caption">
                    {' '}
                    ·{' '}
                    {t('journey.live.wait', '{{time}} wait', {
                      time: units.formatDuration(view.next.wait_s),
                    })}
                  </Text>
                ) : null}
              </Text>
            ) : (
              <Text as="p" size="sm" color="secondary">
                {t('journey.live.noNextStop', 'No scored stop yet')}
              </Text>
            )}
          </div>

          <Text as="p" variant="caption" className="tabular-nums">
            {t('journey.live.lastFix', 'Last fix {{time}}', {
              time: formatTime(view.latest.recorded_at),
            })}{' '}
            · {t('journey.live.fixes', '{{count}} fixes', { count: trail.length })}
          </Text>

          <JourneyEvidenceList evidence={liveEvidence} />
        </div>
      ) : emptyTrip}
      </SourceContent>
    </LayoutCard>
  );
}
