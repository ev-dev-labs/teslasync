import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Badge, Caption, Text } from '@/components/ui';
import { combineDataStates, deriveDataState } from '@/api/dataState';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useFleetTelemetryErrorVINs, useFleetTelemetryErrors } from '@/api/hooks/useTelemetry';
import { fmtInt } from '@/lib/numberFormat';
import { severityTokens, typography } from '@/lib/tokens';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';

const ONE_HOUR_MS = 60 * 60 * 1000;

export default function TelemetryErrorsWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const vinsQuery = useFleetTelemetryErrorVINs();
  const errorsQuery = useFleetTelemetryErrors();
  const {
    data: errorVINs,
    isLoading: vinsLoading,
    isFetching: vinsFetching,
    isStale: vinsStale,
    isError: vinsError,
    refetch: refetchVINs,
  } = vinsQuery;

  const {
    data: errors,
    isLoading: errorsLoading,
    isFetching: errorsFetching,
    isStale: errorsStale,
    isError: errorsIsError,
    refetch: refetchErrors,
  } = errorsQuery;
  const sourceStates = [vinsQuery, errorsQuery].map((query) =>
    deriveDataState({ ...query, data: query.data ?? (
      vinsQuery.isLoading || errorsQuery.isLoading || vinsQuery.isError || errorsQuery.isError
        || vinsQuery.error || errorsQuery.error ? undefined : null) }));
  const state = { ...sourceStates[0]!, ...combineDataStates(sourceStates) };
  if (errorVINs == null && errors == null && (vinsQuery.isError || errorsQuery.isError || vinsQuery.error || errorsQuery.error)) {
    state.status = 'initialFailure';
    state.fatalError = sourceStates.find((source) => source.fatalError)?.fatalError ?? null;
  }

  const isCompact = size.cols <= 1;

  const vinList = errorVINs ?? [];
  const errorList = errors ?? [];

  const activeVINCount = errorVINs == null || vinList.some((v) => v.active == null)
    ? null : vinList.filter((v) => v.active).length;

  // Aggregate errors by VIN + error_code for feed display
  const aggregated = useMemo(() => {
    const map = new Map<string, { vin: string; error_code: string; count: number; last_seen: string; observed: boolean }>();
    for (const e of errorList) {
      const key = `${e.vin}::${e.error_code ?? 'unknown'}`;
      const existing = map.get(key);
      const reported = e.reported_at && Number.isFinite(Date.parse(e.reported_at)) ? e.reported_at : null;
      const ts = reported ?? (e.fetched_at && Number.isFinite(Date.parse(e.fetched_at)) ? e.fetched_at : null);
      if (existing) {
        existing.count += 1;
        if (ts && (!existing.last_seen || Date.parse(ts) > Date.parse(existing.last_seen))) {
          existing.last_seen = ts;
          existing.observed = reported != null;
        }
      } else {
        map.set(key, {
          vin: e.vin,
          error_code: e.error_code ?? t('widget.telemetryErrors.unknown', 'Unknown'),
          count: 1,
          last_seen: ts ?? '',
          observed: reported != null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.last_seen && !b.last_seen) return 0;
      if (!a.last_seen) return 1;
      if (!b.last_seen) return -1;
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });
  }, [errorList, t]);

  const loading = vinsLoading || errorsLoading;
  const hasData = vinList.length > 0 || errorList.length > 0;

  const statusBadge = activeVINCount == null ? 'neutral' : activeVINCount > 0
    ? ('danger' as const)
    : ('success' as const);

  const statusLabel = activeVINCount == null
    ? t('widget.telemetryErrors.unknown', 'Unknown')
    : activeVINCount > 0
    ? t('widget.telemetryErrors.errors', 'Errors')
    : t('widget.telemetryErrors.healthy', 'Healthy');

  const isErrored = vinsError || errorsIsError;

  // Only escalate to a full error panel when there is nothing to show. While we
  // still hold data we degrade gracefully — stale content plus the freshness
  // error dot — rather than blanking the widget or (worse) implying "healthy"
  // via the empty state.
  const errorMessage = state.fatalError?.message;

  // Refresh BOTH sources. The error feed is driven by useFleetTelemetryErrors,
  // so refetching only the VIN summary left the feed stale after a manual
  // refresh.
  const handleRefresh = useCallback(() => {
    void refetchVINs();
    void refetchErrors();
  }, [refetchVINs, refetchErrors]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.telemetryErrors.title', 'Telemetry errors')}
      icon={<AlertCircle className={`h-3.5 w-3.5 ${severityTokens.critical.fg}`} />}
      loading={loading}
      dataState={state}
      error={errorMessage}
      updatedAt={state.updatedAt ?? 0}
      isFetching={vinsFetching || errorsFetching}
      isStale={vinsStale || errorsStale}
      isError={isErrored}
      onRefresh={handleRefresh}
    >
      {!hasData && isCompact && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<AlertCircle className="h-5 w-5" />}
          message={t('widget.telemetryErrors.noData', 'No telemetry error data')}
          className="py-4"
        />
      )}
      {isCompact ? (
        /* ── Compact layout (1×2) ── */
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
          <WidgetBigNumber value={activeVINCount == null ? null : fmtInt(activeVINCount)} label={t('widget.telemetryErrors.errorVINs', 'Error VINs')} />
          <Badge variant={statusBadge} className="text-xs min-h-[28px]">
            {statusLabel}
          </Badge>
        </div>
      ) : (
        /* ── Standard layout (2×4) ── */
        <div className="flex flex-col gap-2 h-full">
          {/* Header stats */}
          <div className="flex items-center justify-between">
            <Caption>
              {t('widget.telemetryErrors.activeVINs', '{{count}} VINs with errors', {
                count: activeVINCount ?? undefined,
                replace: { count: activeVINCount ?? '—' },
              })}
            </Caption>
            <Badge variant={statusBadge} className="text-2xs">
              {statusLabel}
            </Badge>
          </div>
          <WidgetStatGrid cols={2} stats={[
            { label: t('widget.telemetryErrors.errorVINs', 'Error VINs'), value: activeVINCount == null ? '—' : fmtInt(activeVINCount) },
            { label: t('widget.telemetryErrors.sample', 'Errors in fetched sample'), value: errors == null ? '—' : fmtInt(errorList.length) },
          ]} />

          {/* Error feed */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {aggregated.length === 0 ? (
              <Text variant="bodySm" className="text-center py-4">
                {errors == null ? t('widget.telemetryErrors.noData', 'No telemetry error data')
                  : t('widget.telemetryErrors.noErrors', 'No errors recorded')}
              </Text>
            ) : (
              aggregated.map((entry, idx) => {
                const isRecent = entry.observed && entry.last_seen
                  ? Date.now() - new Date(entry.last_seen).getTime() < ONE_HOUR_MS
                  : false;
                return (
                  <div
                    key={`${entry.vin}-${entry.error_code}-${idx}`}
                    className="flex items-center gap-2 rounded-shape-sm bg-[var(--surface-2)] px-2 py-1.5 min-h-11"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Text variant="bodySm" className="font-mono truncate max-w-[120px]" title={entry.vin}>
                          {entry.vin}
                        </Text>
                        {isRecent && (
                          <Badge variant="danger" size="sm" dot>
                            {t('widget.telemetryErrors.recent', 'Recent')}
                          </Badge>
                        )}
                      </div>
                      <Caption className="truncate block" title={entry.error_code}>
                        {entry.error_code}
                      </Caption>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <Caption>
                        ×{fmtInt(entry.count)}
                      </Caption>
                      <Caption>{entry.observed ? t('widget.telemetryErrors.observed', 'Observed') : t('widget.telemetryErrors.fetched', 'Fetched')}</Caption>
                      <TimeStamp value={entry.last_seen || null} className={typography.role.caption} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
