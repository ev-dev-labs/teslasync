import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useVersionInfo, useCaptureStats } from '@/api/hooks/useSettings';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetStatusGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';

function formatUptime(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  if (total === 0) return '0m';
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const mins = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function VersionInfoWidget({ size }: WidgetProps) {
  const { locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');

  const version = useVersionInfo();
  const capture = useCaptureStats();

  const isCompact = size.cols <= 1;

  const versionData = version.data ?? {} as Record<string, unknown>;
  const captureData = capture.data ?? {} as Record<string, unknown>;

  const chartVersion = (versionData as { chart_version?: string }).chart_version ?? '—';
  const buildDate = (versionData as { build_date?: string }).build_date ?? '—';
  const gitSha = (versionData as { git_commit?: string }).git_commit;
  const uptimeSeconds = (versionData as { uptime_seconds?: unknown }).uptime_seconds;
  const uptime = formatUptime(uptimeSeconds);

  const captureEnabled = (captureData as { capture_enabled?: boolean }).capture_enabled;
  const totalDocuments = knownNumber((captureData as { total_documents?: number }).total_documents);
  const distinctVins = (captureData as { distinct_vins?: string[] | null }).distinct_vins;
  const signalsPerSec = knownNumber((captureData as { signals_per_sec?: number }).signals_per_sec);
  const messagesToday = knownNumber((captureData as { messages_today?: number }).messages_today);
  const bytesProcessed = knownNumber((captureData as { bytes_processed?: number }).bytes_processed);
  const avgLatency = knownNumber((captureData as { avg_processing_latency_ms?: number }).avg_processing_latency_ms);

  const truncatedSha = gitSha?.slice(0, 7) ?? '—';

  const detailEntries = useMemo<DetailEntry[]>(() => [
    {
      id: 'version',
      label: t('widget.versionInfo.teslaSync', 'TeslaSync'),
      value: chartVersion,
    },
    {
      id: 'build-date',
      label: t('widget.versionInfo.build', 'Build'),
      value: truncatedSha,
      mono: true,
      hint: buildDate === '—' ? undefined : buildDate,
    },
    {
      id: 'uptime',
      label: t('widget.versionInfo.serverUptime', 'Server uptime'),
      value: uptime,
    },
    {
      id: 'data-capture',
      label: t('widget.versionInfo.dataCapture', 'Data capture'),
      value: captureEnabled == null
        ? '—'
        : captureEnabled
          ? t('widget.versionInfo.captureEnabled', 'Enabled')
          : t('widget.versionInfo.captureDisabled', 'Disabled'),
      badge: totalDocuments == null ? undefined : {
        text: `${totalDocuments.toLocaleString(displayLocale)} ${t('widget.versionInfo.documents', 'documents')}`,
        variant: 'neutral',
      },
      hint: Array.isArray(distinctVins)
        ? t('widget.versionInfo.distinctVins', '{{count}} VINs', { count: distinctVins.length })
        : undefined,
    },
  ], [t, chartVersion, buildDate, truncatedSha, uptime, captureEnabled, totalDocuments, distinctVins, displayLocale]);

  const versionState = useDataState(version, { unavailable: version.data == null });
  const captureState = useDataState(capture, { unavailable: capture.data == null });
  const retry = () => { void version.refetch(); void capture.refetch(); };
  const dataState = {
    ...(isCompact ? versionState : combineDataStates([versionState, captureState])),
    data: isCompact ? version.data : [version.data, capture.data],
    hasData: versionState.hasData || (!isCompact && captureState.hasData),
    retry,
  };
  const hasData = version.data != null;

  return (
    <WidgetShell
      title={t('widget.versionInfo.title', 'Version info')}
      icon={<Info className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={dataState.isRefreshing}
      isStale={version.isStale || (!isCompact && capture.isStale)}
      isError={version.isError || (!isCompact && capture.isError)}
      onRefresh={retry}
    >
      {isCompact ? (
        hasData ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <Text size="lg" weight="semibold" color="primary" className="max-w-full break-words tabular-nums">{chartVersion}</Text>
            <Badge variant="neutral" className="text-2xs">
              {truncatedSha}
            </Badge>
          </div>
        ) : (
          <EmptyState /* no-action: the widget header already exposes version refresh */
            icon={<Info className="h-5 w-5" />} message={t('widget.versionInfo.noData', 'No version data available')} className="py-4" />
        )
      ) : (
          /* ── Standard / Wide layout ── */
          <div className="flex flex-col gap-3 h-full">
            <SourceContent
              state={versionState.fatalError ? 'error' : !versionState.hasData ? 'loading' : !hasData ? 'empty' : versionState.refreshError ? 'retained' : 'ready'}
              label={t('widget.versionInfo.title', 'Version info')}
              emptyMessage={t('widget.versionInfo.noData', 'No version data available')}
              errorMessage={t('widget.versionInfo.versionError', 'Version information could not be loaded.')}
              error={versionState.fatalError}
              errorRecovery={{ onRetry: versionState.retry ?? undefined }}
              retainedMessage={t('widget.versionInfo.versionRetained', 'Previously loaded version information remains visible while it refreshes.')}
            >
              <WidgetDetailCard
                entries={detailEntries}
                compact={false}
                emptyMessage={t('widget.versionInfo.noData', 'No version data available')}
                emptyIcon={<Info className="h-5 w-5" />}
              />
            </SourceContent>
            {capture.data != null && (signalsPerSec != null || messagesToday != null || bytesProcessed != null || avgLatency != null) && (
              <WidgetStatusGrid
                cols={4}
                cells={[
                  ...(signalsPerSec == null ? [] : [{ id: 'signals-sec', label: t('widget.versionInfo.signalsPerSec', 'Signals/sec'), value: signalsPerSec.toLocaleString(displayLocale), status: 'inactive' as const }]),
                  ...(messagesToday == null ? [] : [{ id: 'messages-today', label: t('widget.versionInfo.messagesToday', 'Messages today'), value: messagesToday.toLocaleString(displayLocale), status: 'inactive' as const }]),
                  ...(bytesProcessed == null ? [] : [{ id: 'bytes-processed', label: t('widget.versionInfo.bytesProcessed', 'Bytes processed'), value: bytesProcessed.toLocaleString(displayLocale), status: 'inactive' as const }]),
                  ...(avgLatency == null ? [] : [{ id: 'avg-latency', label: t('widget.versionInfo.avgLatency', 'Avg latency'), value: `${avgLatency.toLocaleString(displayLocale)} ms`, status: 'inactive' as const }]),
                ]}
              />
            )}
            <div className="mt-auto">
              <StaleRefreshWarning state={captureState} />
              {captureState.fatalError && <QueryError error={captureState.fatalError} onRetry={captureState.retry ?? undefined} />}
              {!captureState.hasData && capture.isLoading && <Skeleton className="mb-2 h-8 w-full" />}
            </div>
          </div>
      )}
    </WidgetShell>
  );
}
