import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeparture, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';
import { formatTime } from '@/lib/dateFormat';

import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
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
  const slots = safeArray(advice?.slots);

  if (!hasOrigin) {
    return (
      <LayoutCard title={t('journey.departure.title', 'When to leave')}>
      <Text as="p" variant="bodySm">
        {t(
          'journey.departure.noOrigin',
          'Add an origin to advise departure hours for this journey.',
        )}
      </Text>
      </LayoutCard>
    );
  }

  return (
    <LayoutCard
      title={t('journey.departure.title', 'When to leave')}
      actions={
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('journey.departure.window', 'Window')}>
          {HORIZONS.map((h) => (
            <Button
              key={h}
              wrapLabel
              variant={horizonH === h ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={horizonH === h}
              onClick={() => setHorizonH(h)}
            >
              {t('journey.departure.hours', '{{h}}h', { h })}
            </Button>
          ))}
        </div>
      }
    >
      <SourceContent
        state={adviceState.fatalError ? 'error' : adviceQuery.isLoading && !adviceState.hasData
          ? 'loading' : adviceState.status === 'stale' ? 'retained' : advice == null || slots.length === 0 ? 'empty' : 'ready'}
        label={t('journey.departure.title', 'When to leave')}
        emptyMessage={t('journey.departure.uncovered', 'The forecast covers none of this window.')}
        errorMessage={t('journey.departure.loadFailed', 'Departure advice could not be loaded.')}
        error={adviceState.fatalError}
        errorRecovery={{ onRetry: adviceState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.departure.loading', 'Scoring departure hours…')} />}
      >
      {advice != null && slots.length > 0 ? (
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
                    pct: fmtNumber(advice.charge.soc_pct),
                  })}
                </Text>
              ) : null}
            </div>
          ) : (
            <Badge variant="danger">
              {t('journey.departure.allWarn', 'Every hour warns — delay if you can')}
            </Badge>
          )}
          <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t('journey.departure.slots', 'Departure hours')}>
            {slots.map((slot) => (
              <Text
                as="li"
                variant="caption"
                key={slot.depart_at}
                title={slot.level}
                className={`rounded-md border px-2 py-1 tabular-nums ${
                  slot.depart_at === advice.recommended_at
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-2)]'
                }`}
              >
                <Badge variant={levelVariant(slot.level)}>{formatTime(slot.depart_at)}</Badge>
              </Text>
            ))}
          </ul>
          <JourneyEvidenceList evidence={safeArray(advice.evidence)} />
        </div>
      ) : (
        <Text as="p" variant="bodySm">
          {t('journey.departure.uncovered', 'The forecast covers none of this window.')}
        </Text>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
