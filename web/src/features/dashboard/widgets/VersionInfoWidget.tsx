import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { KVList } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVersionInfo, useCaptureStats } from '@/api/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${fmtInt(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmtNumber(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmtNumber(bytes / (1024 * 1024))} MB`;
  return `${fmtNumber(bytes / (1024 * 1024 * 1024))} GB`;
}

// The `/system/version` endpoint reports process uptime as `uptime_seconds`
// (a number), not a pre-formatted `uptime` string. Format it here into the
// app's canonical "Nd Nh Nm" ladder, guarding non-finite / non-positive input
// (missing field, freshly-booted server) so the row shows an em dash instead
// of "NaNm".
function formatUptime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (total === 0) return '—';
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const mins = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function VersionInfoWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');

  const version = useVersionInfo();
  const capture = useCaptureStats();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const versionData = version.data ?? {} as Record<string, unknown>;
  const captureData = capture.data ?? {} as Record<string, unknown>;

  const chartVersion = (versionData as { chart_version?: string }).chart_version ?? '—';
  const goVersion = (versionData as { go_version?: string }).go_version ?? '—';
  const buildDate = (versionData as { build_date?: string }).build_date ?? '—';
  const gitSha = (versionData as { git_commit?: string }).git_commit;
  const uptimeSeconds = (versionData as { uptime_seconds?: number }).uptime_seconds ?? 0;
  const uptime = formatUptime(uptimeSeconds);
  const osInfo = (versionData as { os?: string }).os ?? '—';
  const archInfo = (versionData as { arch?: string }).arch ?? '—';

  // CaptureStats reports documents and enablement, not throughput or latency.
  // Keep these established sections visible without inventing measurements.
  const signalsPerSec = knownNumber((captureData as { signals_per_sec?: number }).signals_per_sec);
  const messagesToday = knownNumber((captureData as { messages_today?: number }).messages_today);
  const bytesProcessed = knownNumber((captureData as { bytes_processed?: number }).bytes_processed);
  const avgLatency = knownNumber((captureData as { avg_processing_latency_ms?: number }).avg_processing_latency_ms);

  const truncatedSha = gitSha?.slice(0, 7) ?? '—';

  const kvItems = useMemo(() => [
    {
      label: t('widget.versionInfo.version', 'Version'),
      value: <span className="font-bold">{chartVersion}</span>,
    },
    {
      label: t('widget.versionInfo.buildDate', 'Build date'),
      value: buildDate,
    },
    {
      label: t('widget.versionInfo.gitSha', 'Git SHA'),
      value: <span className="font-mono break-all">{truncatedSha}</span>,
    },
    {
      label: t('widget.versionInfo.goVersion', 'Go version'),
      value: goVersion,
    },
    {
      label: t('widget.versionInfo.uptime', 'Uptime'),
      value: uptime,
    },
  ], [t, chartVersion, buildDate, truncatedSha, goVersion, uptime]);

  const statItems = useMemo<StatGridItem[]>(() => {
    const items: StatGridItem[] = [
      {
        label: t('widget.versionInfo.signalsPerSec', 'Signals/sec'),
        value: signalsPerSec == null ? '—' : fmtNumber(signalsPerSec),
      },
      {
        label: t('widget.versionInfo.messagesToday', 'Messages today'),
        value: messagesToday == null ? '—' : fmtInt(messagesToday),
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.versionInfo.bytesProcessed', 'Bytes processed'),
          value: bytesProcessed == null ? '—' : formatBytes(bytesProcessed),
        },
        {
          label: t('widget.versionInfo.avgLatency', 'Avg latency'),
          value: avgLatency == null ? '—' : `${fmtNumber(avgLatency)} ms`,
        },
      );
    }

    return items;
  }, [t, signalsPerSec, messagesToday, bytesProcessed, avgLatency, isWide, fmtNumber, fmtInt, displayPrecision, displayLocale]);

  const versionState = useDataState(version);
  const captureState = useDataState(capture);
  const retry = () => { void version.refetch(); void capture.refetch(); };
  const dataState = {
    ...(versionState.hasData && !isCompact
      ? combineDataStates([versionState, captureState])
      : versionState),
    data: version.data,
    hasData: versionState.hasData,
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
      {hasData ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <span className={dashboardTokens.secondaryMetric}>{chartVersion}</span>
            <Badge variant="neutral" className="text-2xs">
              {truncatedSha}
            </Badge>
          </div>
        ) : (
          /* ── Standard / Wide layout ── */
          <div className="flex flex-col gap-3 h-full">
            <KVList items={kvItems} />

            {isWide && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span>{t('widget.versionInfo.os', 'OS')}: {osInfo}</span>
                <span>•</span>
                <span>{t('widget.versionInfo.arch', 'Arch')}: {archInfo}</span>
              </div>
            )}

            <div className="mt-auto">
              <WidgetStatGrid stats={statItems} compact={isCompact} cols={isWide ? 4 : 2} />
            </div>
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Info className="h-5 w-5" />}
          message={t('widget.versionInfo.noData', 'No version data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
