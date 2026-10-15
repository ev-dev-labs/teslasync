import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { DataStatus } from '@/api/dataState';

interface SignalBounds {
  signal: string;
  from?: string;
  to?: string;
}

function hasValidBounds(bound: SignalBounds): boolean {
  const from = bound.from ? Date.parse(bound.from) : NaN;
  const to = bound.to ? Date.parse(bound.to) : NaN;
  return Number.isFinite(from) && Number.isFinite(to) && from <= to;
}

interface Props {
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  scope: ReactNode;
  provenance: string;
  testId: string;
  loading?: boolean;
  unavailable?: boolean;
  retained?: boolean;
  unknown?: boolean;
  statusLabel?: string;
  freshness?: ReactNode;
  sourceStatus?: DataStatus;
  sourceBounds?: readonly SignalBounds[];
  requestedBounds?: readonly SignalBounds[];
  observedBounds?: readonly SignalBounds[];
  capReached?: boolean;
  completenessUnknown?: boolean;
  lastSuccessAt?: string;
}

export function TelemetrySummaryBrief({
  title, description, metrics, scope, provenance, testId, loading = false,
  unavailable = false, retained = false, unknown = false, statusLabel, freshness, sourceStatus, sourceBounds = [],
  requestedBounds = [], observedBounds = [], capReached = false, completenessUnknown = false, lastSuccessAt,
}: Props) {
  const { t } = useTranslation();
  const { formatDateTime, tz } = useDateFormat();
  const operationalMetrics = useOperationalMetrics(metrics);
  const coverageUnknown = capReached || completenessUnknown;
  const lastSuccess = lastSuccessAt && Number.isFinite(Date.parse(lastSuccessAt))
    ? lastSuccessAt : undefined;
  const localizedBounds = (bound: SignalBounds) => hasValidBounds(bound)
    ? ` (${formatDateTime(bound.from)} → ${formatDateTime(bound.to)} · ${tz})`
    : null;
  return (
    <OperationalBrief compact testId={testId} metrics={operationalMetrics}
      eyebrow={t('telemetry.brief.eyebrow', 'Telemetry evidence')}
      title={title} description={description}
      scope={<>{scope}{sourceBounds.map((bound, index) => <Caption key={`${bound.signal}-${index}`} className="min-w-0 break-words">
        {' · '}{hasValidBounds(bound)
          ? t('telemetry.brief.returnedBounds', '{{signal}} source bounds: {{from}} → {{to}}', bound)
          : t('telemetry.brief.sourceBoundsUnknown', '{{signal}} source bounds not supplied', { signal: bound.signal })}
        {localizedBounds(bound)}
      </Caption>)}
        {requestedBounds.map((bound, index) => <Caption key={`requested-${bound.signal}-${index}`} className="min-w-0 break-words">
          {' · '}{bound.signal}{' · '}{hasValidBounds(bound)
            ? t('teslaOnly.scopeRequested', 'Requested: {{from}} → {{to}}', bound)
            : <>{t('fleetOps.status.requested', 'Requested')}{' · '}{t('telemetry.brief.sourceBoundsUnknown', '{{signal}} source bounds not supplied', { signal: bound.signal })}</>}
          {localizedBounds(bound)}
        </Caption>)}
        {observedBounds.map((bound, index) => <Caption key={`observed-${bound.signal}-${index}`} className="min-w-0 break-words">
          {' · '}{bound.signal}{' · '}{hasValidBounds(bound)
            ? t('resaleVault.brief.window', 'Observed evidence: {{start}} → {{end}}', { start: bound.from, end: bound.to })
            : <>{t('chargeAdvisor.current.observed', 'Observed')}{' · '}{t('telemetry.brief.sourceBoundsUnknown', '{{signal}} source bounds not supplied', { signal: bound.signal })}</>}
          {localizedBounds(bound)}
        </Caption>)}
        {coverageUnknown && <Caption className="min-w-0 break-words">
          {' · '}{capReached
            ? t('shareCard.card.cappedDisclosure', 'Cap reached; full-range coverage not claimed{{missing}}', { missing: '' })
            : t('shareCard.card.returnedDisclosure', 'Returned evidence; completeness not guaranteed{{missing}}', { missing: '' })}
        </Caption>}
      </>}
      provenance={provenance}
      loading={loading && !retained}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : unavailable || sourceStatus === 'unavailable' ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : unknown ? t('operationalSummary.unknown', 'Source values unknown')
              : sourceStatus === 'partial' || coverageUnknown ? t('telemetry.brief.partial', 'Partial source coverage')
                : statusLabel ?? t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || unavailable || coverageUnknown || sourceStatus === 'partial' || sourceStatus === 'unavailable' ? 'warning' : 'neutral'}
      freshness={<>{freshness ?? (retained
        ? t('developerReference.stats.state.retained', 'Showing retained measurements')
        : undefined)}
        {lastSuccessAt !== undefined && <Caption className="min-w-0 break-words">
          {' · '}{t('supportBundle.source.receivedAt', 'Last successful response: {{time}}', {
            time: lastSuccess ?? t('common.unknown', 'Unknown'),
          })}
          {lastSuccess && ` (${formatDateTime(lastSuccess)} · ${tz})`}
        </Caption>}
      </>}
    />
  );
}
