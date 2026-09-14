import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useDeparture, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, Text } from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { formatTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';

const HORIZONS = [12, 24, 48] as const;

function levelVariant(level: string) {
  switch (level) {
    case 'warning':
      return 'danger' as const;
    case 'watch':
      return 'warning' as const;
    default:
      return 'success' as const;
  }
}

/**
 * Departure advisor: hourly slots ranked on forecast severity at the
 * origin, with the earliest calm hour recommended. Charge context
 * rides along when the vehicle has reported recently.
 */
export function DeparturePanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const [horizonH, setHorizonH] = useState<(typeof HORIZONS)[number]>(12);

  const window = useMemo(() => {
    const from = new Date();
    return { from: from.toISOString(), to: new Date(from.getTime() + horizonH * 3600_000).toISOString() };
  }, [horizonH]);

  const hasOrigin = session.origin_lat != null && session.origin_lng != null;

  const adviceQuery = useDeparture(session.id, window.from, window.to, {
    enabled: hasOrigin,
  });
  const adviceState = useDataState(adviceQuery);
  const advice = adviceQuery.data ?? null;

  if (!hasOrigin) {
    return (
      <Text as="p" size="sm" color="secondary">
        {t(
          'journey.departure.noOrigin',
          'Add an origin to advise departure hours for this journey.',
        )}
      </Text>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" variant="label" className="flex items-center gap-2">
          <Icons.departure className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('journey.departure.title', 'When to leave')}
        </Text>
        <div className="flex gap-1" role="group" aria-label={t('journey.departure.window', 'Window')}>
          {HORIZONS.map((h) => (
            <Button
              key={h}
              variant={horizonH === h ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setHorizonH(h)}
            >
              {t('journey.departure.hours', '{{h}}h', { h })}
            </Button>
          ))}
        </div>
      </div>

      {adviceQuery.isLoading ? (
        <ListSkeleton label={t('journey.departure.loading', 'Scoring departure hours…')} />
      ) : adviceState.fatalError ? (
        <QueryError error={adviceState.fatalError} onRetry={() => adviceState.retry?.()} />
      ) : advice == null || advice.slots.length === 0 ? (
        <Text as="p" size="sm" color="secondary">
          {t('journey.departure.uncovered', 'The forecast covers none of this window.')}
        </Text>
      ) : (
        <div className="space-y-3">
          {advice.recommended_at != null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                {t('journey.departure.leaveAt', 'Leave {{time}}', {
                  time: formatTime(advice.recommended_at),
                })}
              </Badge>
              {advice.charge?.soc_pct != null ? (
                <Text as="span" variant="caption">
                  {t('journey.departure.socNow', 'Battery {{pct}}% now', {
                    pct: fmtNumber(advice.charge.soc_pct, 0),
                  })}
                </Text>
              ) : null}
            </div>
          ) : (
            <Badge variant="danger">
              {t('journey.departure.allWarn', 'Every hour warns — delay if you can')}
            </Badge>
          )}
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={t('journey.departure.slots', 'Departure hours')}>
            {advice.slots.map((slot) => (
              <span
                key={slot.depart_at}
                role="listitem"
                title={slot.level}
                className={`rounded-md border px-2 py-1 text-xs tabular-nums ${
                  slot.depart_at === advice.recommended_at
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-white/[0.07] bg-white/[0.02]'
                }`}
              >
                <Badge variant={levelVariant(slot.level)}>{formatTime(slot.depart_at)}</Badge>
              </span>
            ))}
          </div>
          <ul className="space-y-1">
            {advice.evidence.map((line) => (
              <Text as="li" key={line} size="xs" color="muted">
                · {line}
              </Text>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
