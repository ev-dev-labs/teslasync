import { useTranslation } from 'react-i18next';
import { useArrival, type ChecklistStatus, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, MetricValue, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';
import { formatTime } from '@/lib/dateFormat';

import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const units = useUnits();

  const arrivalQuery = useArrival(session.id);
  const arrivalState = useDataState(arrivalQuery);
  const arrival = arrivalQuery.data ?? null;
  const arrivalEvidence = safeArray(arrival?.evidence);

  return (
    <LayoutCard title={t('journey.arrival.title', 'Arrival')}>
      <SourceContent
        state={arrivalState.fatalError ? 'error' : arrivalQuery.isLoading && !arrivalState.hasData
          ? 'loading' : arrivalState.status === 'stale' ? 'retained' : arrival == null ? 'empty' : 'ready'}
        label={t('journey.arrival.title', 'Arrival')}
        emptyMessage={t('journey.arrival.empty', 'No arrival reading yet.')}
        errorMessage={t('journey.arrival.loadFailed', 'Arrival advice could not be loaded.')}
        error={arrivalState.fatalError}
        errorRecovery={{ onRetry: arrivalState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.arrival.loading', 'Preparing arrival…')} />}
      >
      {arrival != null ? (
        <div className="space-y-3">
          {arrival.dest_name ? (
            <Text as="p" variant="bodySm" className="break-words [overflow-wrap:anywhere]">
              {arrival.dest_name}
            </Text>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Text as="p" variant="label">
              {t('journey.arrival.eta', 'ETA')}
            </Text>
            <MetricValue>
              {arrival.eta_at != null ? formatTime(arrival.eta_at) : '—'}
            </MetricValue>
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
            {arrival.route_factor != null ? (
              <Text as="p" variant="caption" className="tabular-nums">
                {t('journey.arrival.adjusted', 'adjusted {{ratio}}× from {{count}} trips', {
                  ratio: fmtNumber(arrival.route_factor),
                  count: arrival.route_trips,
                })}
              </Text>
            ) : null}
          </div>

          <JourneyEvidenceList evidence={arrivalEvidence} />
        </div>
      ) : (
        <Text as="p" variant="bodySm">{t('journey.arrival.empty', 'No arrival reading yet.')}</Text>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
