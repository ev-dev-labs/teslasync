import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  CircleHelp,
  GitCompareArrows,
} from 'lucide-react';

import { useTransportAgreement } from '@/api/hooks/useSignals';
import { DataProvenanceBadge } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { TransportAgreementFieldList } from './TransportAgreementFieldList';
import { TransportAgreementMetrics } from './TransportAgreementMetrics';

/**
 * Widest window the agreement endpoint accepts, mirroring
 * `transportAgreementMaxHours` in internal/api/signalinspect/handler.go.
 * The API rejects anything wider with 400 instead of narrowing it, so a
 * 30-day or 90-day history query must be answered here with an explicit
 * state rather than an request that can only fail.
 */
export const TRANSPORT_AGREEMENT_MAX_WINDOW_HOURS = 168;

const MS_PER_HOUR = 3_600_000;

/**
 * Hours covered by the submitted window, or null when the boundaries are not
 * two ordered timestamps. Null is "cannot judge", not "within limit": the
 * panel then defers to the API, which validates the range and reports its own
 * explicit error, instead of inventing a limit verdict of its own.
 */
export function transportAgreementWindowHours(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / MS_PER_HOUR;
}

export interface TransportAgreementPanelProps {
  vehicleId: number;
  from: string;
  to: string;
  enabled: boolean;
}

export function TransportAgreementPanel({
  vehicleId,
  from,
  to,
  enabled,
}: TransportAgreementPanelProps) {
  const { t } = useTranslation();
  const windowHours = transportAgreementWindowHours(from, to);
  // The submitted history range is immutable — it is NOT narrowed to fit the
  // audit cap, because a silently shortened window would report agreement for
  // a period the operator never asked about. Instead the request is withheld.
  const exceedsWindowLimit =
    enabled && windowHours != null && windowHours > TRANSPORT_AGREEMENT_MAX_WINDOW_HOURS;
  const query = useTransportAgreement(vehicleId, { from, to }, enabled && !exceedsWindowLimit);
  const data = query.data;
  const fields = data?.fields ?? [];
  const measured = data?.status === 'measured' && data.agreement_pct != null;
  const limitDays = TRANSPORT_AGREEMENT_MAX_WINDOW_HOURS / 24;
  const requestedDays = windowHours == null ? 0 : Math.ceil(windowHours / 24);

  return (
    <FadeIn delay={0.12}>
      <GlassPanel
        className="space-y-4 p-4 sm:p-5"
        role="region"
        aria-label={t('signalTransportAgreement.title', 'HTTP / MQTT Agreement')}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <PanelTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4 text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
              {t('signalTransportAgreement.title', 'HTTP / MQTT Agreement')}
            </PanelTitle>
            <Text as="p" variant="bodySm" color="muted">
              {t(
                'signalTransportAgreement.description',
                'Compares only SI-normalized observations with producer timestamps from both Fleet Telemetry transports.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenanceBadge provenance="historical" />
            {data ? (
              <Badge variant={measured ? 'success' : 'warning'}>
                {measured
                  ? t('signalTransportAgreement.measured', 'Measured')
                  : t('signalTransportAgreement.notMeasured', 'Not measured')}
              </Badge>
            ) : null}
          </div>
        </div>

        {!enabled ? (
          <EmptyState /* no-action: the parent query controls are the recovery surface for this read-only audit. */
            icon={<GitCompareArrows className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'signalTransportAgreement.runQuery',
              'Run a signal query to audit HTTP and MQTT evidence for the same time window.',
            )}
            className="py-8"
          />
        ) : exceedsWindowLimit ? (
          <EmptyState /* no-action: the range control in the query cockpit above is the recovery surface. */
            icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
            title={t(
              'signalTransportAgreement.windowLimitTitle',
              'Agreement is limited to seven days',
            )}
            message={t(
              'signalTransportAgreement.windowLimitDescription',
              'Cross-transport agreement is evaluated over at most {{limitDays}} days ({{limitHours}} hours). This query covers {{requestedDays}} days and is kept exactly as submitted — the signal history below is unchanged. Re-run with a shorter range to audit HTTP and MQTT evidence.',
              {
                limitDays: fmtInt(limitDays),
                limitHours: fmtInt(TRANSPORT_AGREEMENT_MAX_WINDOW_HOURS),
                requestedDays: fmtInt(requestedDays),
              },
            )}
            className="py-8"
          />
        ) : query.isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : query.error ? (
          <QueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            resourceName={t('signalTransportAgreement.resource', 'transport agreement evidence')}
            compact
          />
        ) : !data ? (
          <EmptyState /* no-action: rerunning or changing the parent signal query is the recovery surface. */
            icon={<CircleHelp className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'signalTransportAgreement.unavailable',
              'Transport agreement evidence is not available for this query.',
            )}
            className="py-8"
          />
        ) : (
          <>
            <TransportAgreementMetrics data={data} />
            <TransportAgreementFieldList fields={fields} />
          </>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
