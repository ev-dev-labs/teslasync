import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, CheckCircle2, Clock, MonitorSmartphone } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState, useVehicleConfigLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

type UpdateStatus =
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'installed';

export default function SoftwareUpdateStatusWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { data: configData, isLoading: configLoading } = useVehicleConfigLatest(id, 60_000);

  const isLoading = stateLoading || configLoading;
  const state = stateData?.state;
  const currentVersion = state?.software_version ?? '—';

  const updateVersion = configData?.software_update_version ?? null;
  const downloadPct = configData?.software_update_download_pct ?? null;
  const installPct = configData?.software_update_install_pct ?? null;
  const expectedDuration = configData?.software_update_expected_duration ?? null;
  const scheduledStart = configData?.software_update_scheduled_start ?? null;

  const updateStatus = useMemo<UpdateStatus>(() => {
    if (!updateVersion) return 'up-to-date';
    if (installPct != null && installPct > 0 && installPct < 100) return 'installing';
    if (downloadPct != null && downloadPct > 0 && downloadPct < 100) return 'downloading';
    if (installPct === 100) return 'installed';
    if (downloadPct === 100) return 'ready';
    return 'available';
  }, [updateVersion, downloadPct, installPct]);

  // Show the body when we have EITHER live vehicle state OR a pending update
  // from the config snapshot. The two queries poll independently, so gating
  // solely on live state (which can lag or drop out) would hide an in-flight
  // update behind the empty state — the update section only needs
  // `updateVersion`, and the current-version row already degrades to "—".
  const hasData = state != null || updateVersion != null;

  const isCompact = size.cols <= 1 && size.rows <= 1;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.softwareUpdate', 'Software Update')}
      icon={isCompact ? undefined : <MonitorSmartphone className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        <FadeIn>
          {isCompact ? (
            <CompactView
              version={currentVersion}
              updateStatus={updateStatus}
              t={t}
            />
          ) : (
            <FullView
              version={currentVersion}
              updateVersion={updateVersion}
              downloadPct={downloadPct}
              installPct={installPct}
              expectedDuration={expectedDuration}
              scheduledStart={scheduledStart}
              updateStatus={updateStatus}
              isTall={size.rows >= 2}
              t={t}
            />
          )}
        </FadeIn>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<MonitorSmartphone className="h-5 w-5" />}
          message={t('widget.noSoftwareData', 'No software data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1×1 ── */
function CompactView({
  version,
  updateStatus,
  t,
}: {
  version: string;
  updateStatus: UpdateStatus;
  t: (k: string, f: string) => string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5">
      <MonitorSmartphone className="h-5 w-5 text-neon-cyan" />
      <span className="text-xs font-bold text-[var(--text-primary)] truncate max-w-full px-1">
        {version || '—'}
      </span>
      <StatusBadgeSmall status={updateStatus} t={t} />
    </div>
  );
}

/* ── Full: 2×1+ ── */
function FullView({
  version,
  updateVersion,
  downloadPct,
  installPct,
  expectedDuration,
  scheduledStart,
  updateStatus,
  isTall,
  t,
}: {
  version: string;
  updateVersion: string | null;
  downloadPct: number | null;
  installPct: number | null;
  expectedDuration: number | null;
  scheduledStart: string | null;
  updateStatus: UpdateStatus;
  isTall: boolean;
  t: (k: string, f: string) => string;
}) {
  return (
    <div className="h-full flex flex-col justify-center gap-2.5">
      {/* Current version row */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-2xs text-[var(--text-muted)]">{t('widget.currentVersion', 'Current Version')}</p>
          <p className="text-sm font-bold text-[var(--text-primary)] truncate">{version || '—'}</p>
        </div>
        <StatusBadgeSmall status={updateStatus} t={t} />
      </div>

      {/* Update section — only when an update exists */}
      {updateVersion && updateStatus !== 'up-to-date' && (
        <div className="space-y-2">
          {/* Target version */}
          <div className="flex items-center gap-1.5">
            <Download className="h-3 w-3 text-neon-cyan shrink-0" />
            <span className="text-2xs text-[var(--text-muted)]">
              {t('widget.updateAvailable', 'Update')}:
            </span>
            <span className="text-xs font-semibold text-cyan-300 truncate">
              {updateVersion}
            </span>
          </div>

          {/* Progress bars */}
          {updateStatus === 'downloading' && downloadPct != null && (
            <MetricBar
              value={downloadPct}
              max={100}
              color="#22d3ee"
              label={t('widget.downloading', 'Downloading')}
              sublabel={`${downloadPct}%`}
            />
          )}

          {updateStatus === 'installing' && installPct != null && (
            <MetricBar
              value={installPct}
              max={100}
              color="#a78bfa"
              label={t('widget.installing', 'Installing')}
              sublabel={`${installPct}%`}
            />
          )}

          {updateStatus === 'ready' && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              <span>{t('widget.readyToInstall', 'Ready to install')}</span>
            </div>
          )}

          {/* Expected duration — shown in tall layout when relevant */}
          {isTall && expectedDuration != null && expectedDuration > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] pt-0.5 border-t border-white/[0.06]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {t('widget.estimatedTime', 'Est. time')}: ~{expectedDuration}{' '}
                {t('widget.minutes', 'min')}
              </span>
            </div>
          )}

          {/* Scheduled start — shown when available */}
          {isTall && scheduledStart && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] pt-0.5 border-t border-white/[0.06]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {t('widget.scheduledStart', 'Scheduled')}: {scheduledStart}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Up to date message */}
      {updateStatus === 'up-to-date' && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>{t('widget.upToDate', 'Up to date')}</span>
        </div>
      )}
    </div>
  );
}

/* ── Status badge helper ── */
function StatusBadgeSmall({
  status,
  t,
}: {
  status: UpdateStatus;
  t: (k: string, f: string) => string;
}) {
  const config: Record<UpdateStatus, { variant: 'success' | 'info' | 'warning'; label: string }> = {
    'up-to-date': { variant: 'success', label: t('widget.statusUpToDate', 'Up to date') },
    available: { variant: 'info', label: t('widget.statusAvailable', 'Available') },
    downloading: { variant: 'warning', label: t('widget.statusDownloading', 'Downloading') },
    ready: { variant: 'info', label: t('widget.statusReady', 'Ready') },
    installing: { variant: 'warning', label: t('widget.statusInstalling', 'Installing') },
    installed: { variant: 'success', label: t('widget.statusInstalled', 'Installed') },
  };
  const { variant, label } = config[status];
  return <Badge variant={variant} size="sm" dot>{label}</Badge>;
}
