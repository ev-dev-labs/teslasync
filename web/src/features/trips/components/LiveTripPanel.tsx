import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useCheckIn,
  useJourneyLive,
  type JourneyRangeVerdict,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, Button, Text } from '@/components/ui';
import { EmptyState, ListSkeleton, QueryError } from '@/components/feedback';
import { formatTime } from '@/lib/dateFormat';

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
 * ambient tick; "Check in" drops an explicit trail point on demand.
 */
export function LiveTripPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const units = useUnits();

  const liveQuery = useJourneyLive(session.id);
  const liveState = useDataState(liveQuery);
  const view = liveQuery.data ?? null;

  const checkIn = useCheckIn();
  const busy = liveQuery.isLoading || checkIn.isPending;

  const pct =
    view?.progress != null && view.progress.total_m > 0
      ? Math.min(100, Math.max(0, (view.progress.done_m / view.progress.total_m) * 100))
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" variant="label" className="flex items-center gap-2">
          <Icons.satellite className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('journey.live.title', 'Live trip')}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          loading={checkIn.isPending}
          onClick={() => checkIn.mutate(session.id)}
        >
          {t('journey.live.checkIn', 'Check in')}
        </Button>
      </div>

      {busy ? (
        <ListSkeleton label={t('journey.live.loading', 'Loading live trip…')} />
      ) : liveState.fatalError ? (
        <QueryError error={liveState.fatalError} onRetry={() => liveState.retry?.()} />
      ) : view == null || view.latest == null ? (
        <EmptyState
          icon={<Icons.navigation className="h-10 w-10" aria-hidden="true" />}
          message={t(
            'journey.live.empty',
            'No fixes yet. Check in to drop the first trail point.',
          )}
        />
      ) : (
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
              <div
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('journey.live.progress', 'Progress')}
                className="h-2 overflow-hidden rounded-full bg-white/[0.07]"
              >
                <div
                  className="h-full rounded-full bg-emerald-500/70 transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
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
            · {t('journey.live.fixes', '{{count}} fixes', { count: view.trail.length })}
          </Text>

          {view.evidence.length > 0 ? (
            <ul className="space-y-1">
              {view.evidence.map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
