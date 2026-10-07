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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${fmtInt(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmtNumber(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmtNumber(bytes / (1024 * 1024), 1)} MB`;
  return `${fmtNumber(bytes / (1024 * 1024 * 1024), 2)} GB`;
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

  const signalsPerSec = (captureData as { signals_per_sec?: number }).signals_per_sec ?? 0;
  const messagesToday = (captureData as { messages_today?: number }).messages_today ?? 0;
  const bytesProcessed = (captureData as { bytes_processed?: number }).bytes_processed ?? 0;
  const avgLatency = (captureData as { avg_processing_latency_ms?: number }).avg_processing_latency_ms ?? 0;

  const truncatedSha = gitSha?.slice(0, 7) ?? '—';

  const kvItems = useMemo(() => [
    {
      label: t('widget.versionInfo.version', 'Version'),
      value: <span className="font-bold">{chartVersion}</span>,
    },
    {
      label: t('widget.versionInfo.buildDate', 'Build Date'),
      value: buildDate,
    },
    {
      label: t('widget.versionInfo.gitSha', 'Git SHA'),
      value: <span className="font-mono break-all">{truncatedSha}</span>,
    },
    {
      label: t('widget.versionInfo.goVersion', 'Go Version'),
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
        value: fmtNumber(signalsPerSec, 1),
      },
      {
        label: t('widget.versionInfo.messagesToday', 'Messages Today'),
        value: fmtInt(messagesToday),
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.versionInfo.bytesProcessed', 'Bytes Processed'),
          value: formatBytes(bytesProcessed),
        },
        {
          label: t('widget.versionInfo.avgLatency', 'Avg Latency'),
          value: `${fmtNumber(avgLatency, 1)} ms`,
        },
      );
    }

    return items;
  }, [t, signalsPerSec, messagesToday, bytesProcessed, avgLatency, isWide]);

  const isLoading = version.isLoading;
  const hasError = version.error ? String(version.error) : null;
  const hasData = version.data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.versionInfo.title', 'Version Info')}
      icon={<Info className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={hasError}
      updatedAt={version.dataUpdatedAt}
      isFetching={version.isFetching}
      isStale={version.isStale}
      isError={version.isError}
      onRefresh={() => version.refetch()}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <span className="text-sm font-bold text-[var(--text-primary)] truncate">{chartVersion}</span>
            <Badge variant="neutral" className="text-2xs">
              {truncatedSha}
            </Badge>
          </div>
        ) : (
          /* ── Standard / Wide layout ── */
          <div className="flex flex-col gap-3 h-full">
            <KVList items={kvItems} />

            {isWide && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
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
