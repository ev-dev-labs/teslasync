import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useArrival, type ChecklistStatus, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, Text } from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { formatTime } from '@/lib/dateFormat';

const VERDICT_LABEL_KEYS: Record<ChecklistStatus, string> = {
  ok: 'journey.arrival.verdict.ok',
  attention: 'journey.arrival.verdict.attention',
  action: 'journey.arrival.verdict.action',
  unknown: 'journey.arrival.verdict.unknown',
};

const VERDICT_DEFAULTS: Record<ChecklistStatus, string> = {
  ok: 'Arrive with buffer',
  attention: 'Arrive tight',
  action: 'Top up en route',
  unknown: 'Unknown',
};

function verdictVariant(verdict: ChecklistStatus) {
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
 * Arrival prep: ETA from recent pace plus the charge advice for the
 * destination. Read-only — the numbers refresh on the ambient live
 * tick and on every check-in.
 */
export function ArrivalPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const units = useUnits();

  const arrivalQuery = useArrival(session.id);
  const arrivalState = useDataState(arrivalQuery);
  const arrival = arrivalQuery.data ?? null;

  return (
    <div className="space-y-4">
      <Text as="p" variant="label" className="flex items-center gap-2">
        <Icons.flag className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('journey.arrival.title', 'Arrival')}
        {arrival?.dest_name ? (
          <Text as="span" variant="caption">
            · {arrival.dest_name}
          </Text>
        ) : null}
      </Text>

      {arrivalQuery.isLoading ? (
        <ListSkeleton label={t('journey.arrival.loading', 'Preparing arrival…')} />
      ) : arrivalState.fatalError ? (
        <QueryError error={arrivalState.fatalError} onRetry={() => arrivalState.retry?.()} />
      ) : arrival == null ? (
        <Text as="p" size="sm" color="secondary">
          {t('journey.arrival.empty', 'No arrival reading yet.')}
        </Text>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Text as="p" variant="label">
              {t('journey.arrival.eta', 'ETA')}
            </Text>
            <span className="text-2xl font-semibold tabular-nums">
              {arrival.eta_at != null ? formatTime(arrival.eta_at) : '—'}
            </span>
            <Text as="p" variant="caption" className="tabular-nums">
              {arrival.moving
                ? t('journey.arrival.moving', 'moving')
                : t('journey.arrival.parked', 'parked')}
              {arrival.pace_ms != null ? ` · ${units.formatSpeed(arrival.pace_ms)}` : null}
              {arrival.left_m != null ? ` · ${units.formatDistance(arrival.left_m)}` : null}
            </Text>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(arrival.verdict)}>
              {t(VERDICT_LABEL_KEYS[arrival.verdict], VERDICT_DEFAULTS[arrival.verdict])}
            </Badge>
            {arrival.shortfall_wh != null ? (
              <Text as="p" variant="caption" className="tabular-nums">
                {t('journey.arrival.shortfall', 'top up ≈ {{energy}} en route', {
                  energy: units.formatEnergy(arrival.shortfall_wh),
                })}
              </Text>
            ) : null}
          </div>

          {arrival.evidence.length > 0 ? (
            <ul className="space-y-1">
              {arrival.evidence.map((line) => (
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
