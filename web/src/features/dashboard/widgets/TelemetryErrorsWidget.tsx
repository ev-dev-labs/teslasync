import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useFleetTelemetryErrorVINs, useFleetTelemetryErrors } from '@/api/hooks/useTelemetry';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const ONE_HOUR_MS = 60 * 60 * 1000;

export default function TelemetryErrorsWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const {
    data: errorVINs,
    isLoading: vinsLoading,
    isFetching: vinsFetching,
    isStale: vinsStale,
    isError: vinsError,
    dataUpdatedAt: vinsUpdatedAt,
    refetch: refetchVINs,
  } = useFleetTelemetryErrorVINs();

  const {
    data: errors,
    isLoading: errorsLoading,
    isFetching: errorsFetching,
    isStale: errorsStale,
    isError: errorsIsError,
    dataUpdatedAt: errorsUpdatedAt,
  } = useFleetTelemetryErrors();

  const isCompact = size.cols <= 1;

  const vinList = errorVINs ?? [];
  const errorList = errors ?? [];

  const activeVINCount = vinList.filter((v) => v.active).length;

  // Aggregate errors by VIN + error_code for feed display
  const aggregated = useMemo(() => {
    const map = new Map<string, { vin: string; error_code: string; count: number; last_seen: string }>();
    for (const e of errorList) {
      const key = `${e.vin}::${e.error_code ?? 'unknown'}`;
      const existing = map.get(key);
      const ts = e.reported_at ?? e.fetched_at;
      if (existing) {
        existing.count += 1;
        if (ts && ts > existing.last_seen) existing.last_seen = ts;
      } else {
        map.set(key, {
          vin: e.vin,
          error_code: e.error_code ?? t('widget.telemetryErrors.unknown', 'Unknown'),
          count: 1,
          last_seen: ts ?? '',
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

  const statusBadge = activeVINCount > 0
    ? ('danger' as const)
    : ('success' as const);

  const statusLabel = activeVINCount > 0
    ? t('widget.telemetryErrors.errors', 'Errors')
    : t('widget.telemetryErrors.healthy', 'Healthy');

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.telemetryErrors.title', 'Telemetry Errors')}
      icon={<AlertCircle className="h-3.5 w-3.5 text-red-400" />}
      loading={loading}
      updatedAt={Math.max(vinsUpdatedAt ?? 0, errorsUpdatedAt ?? 0)}
      isFetching={vinsFetching || errorsFetching}
      isStale={vinsStale || errorsStale}
      isError={vinsError || errorsIsError}
      onRefresh={() => refetchVINs()}
    >
      {!hasData ? (
        <EmptyState
          icon={<AlertCircle className="h-5 w-5" />}
          message={t('widget.telemetryErrors.noData', 'No telemetry error data')}
          className="py-4"
        />
      ) : isCompact ? (
        /* ── Compact layout (1×2) ── */
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
          <span className="text-lg font-bold text-white/90">
            {fmtInt(activeVINCount)}
          </span>
          <span className="text-[10px] text-white/50">
            {t('widget.telemetryErrors.errorVINs', 'error VINs')}
          </span>
          <Badge variant={statusBadge} className="text-xs min-h-[28px]">
            {statusLabel}
          </Badge>
        </div>
      ) : (
        /* ── Standard layout (2×4) ── */
        <div className="flex flex-col gap-2 h-full">
          {/* Header stats */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">
              {t('widget.telemetryErrors.activeVINs', '{{count}} VINs with errors', { count: activeVINCount })}
            </span>
            <Badge variant={statusBadge} className="text-[10px]">
              {statusLabel}
            </Badge>
          </div>

          {/* Error feed */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {aggregated.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-4">
                {t('widget.telemetryErrors.noErrors', 'No errors recorded')}
              </p>
            ) : (
              aggregated.map((entry, idx) => {
                const isRecent = entry.last_seen
                  ? Date.now() - new Date(entry.last_seen).getTime() < ONE_HOUR_MS
                  : false;
                return (
                  <div
                    key={`${entry.vin}-${entry.error_code}-${idx}`}
                    className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 min-h-[44px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-white/70 truncate max-w-[120px]">
                          {entry.vin}
                        </span>
                        {isRecent && (
                          <Badge variant="danger" size="sm" dot>
                            {t('widget.telemetryErrors.recent', 'recent')}
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-white/40 truncate block">
                        {entry.error_code}
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-xs font-medium text-white/70">
                        ×{fmtInt(entry.count)}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {formatRelative(entry.last_seen || null)}
                      </span>
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
