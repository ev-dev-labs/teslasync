import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, CheckCircle2, Clock, MonitorSmartphone } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleState, useVehicleConfigLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { combineDataStates } from '@/api/dataState';
import { isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

type UpdateStatus =
  | 'unknown'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'installed';

export default function SoftwareUpdateStatusWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const rawId = vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = rawId != null && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : 0;
  const stateQuery = useVehicleState(id);
  const configQuery = useVehicleConfigLatest(id, 60_000);
  const { data: stateData, isLoading: stateLoading } = stateQuery;
  const { data: configData, isLoading: configLoading } = configQuery;
  const stateState = useDataState(stateQuery);
  const configState = useDataState(configQuery, {
    partial: [configData?.software_update_download_pct, configData?.software_update_install_pct]
      .some(value => value != null && (!isFiniteNumber(value) || value < 0 || value > 100)),
  });
  const vehiclesState = useDataState(vehiclesQuery);
  const handleRefresh = useCallback(() => {
    if (!id) {
      void vehiclesQuery.refetch();
      return;
    }
    void stateQuery.refetch();
    void configQuery.refetch();
  }, [id, vehiclesQuery.refetch, stateQuery.refetch, configQuery.refetch]);
  const combined = combineDataStates([stateState, configState]);
  const hasPayload = stateState.hasData || configState.hasData;
  const sourceError = stateState.fatalError ?? configState.fatalError;
  const dataState = id ? {
    ...combined,
    data: stateData ?? configData,
    hasData: hasPayload,
    fatalError: hasPayload ? null : sourceError,
    refreshError: hasPayload ? combined.refreshError ?? sourceError : null,
    status: !hasPayload && sourceError ? 'initialFailure' as const : combined.status,
    retry: handleRefresh,
  } : vehiclesState;
  const sourceTimes = [stateState.updatedAt, configState.updatedAt]
    .filter((value): value is number => value != null);
  const dataUpdatedAt = id
    ? sourceTimes.length > 0 ? Math.min(...sourceTimes) : 0
    : vehiclesQuery.dataUpdatedAt;
  const isFetching = id ? stateQuery.isFetching || configQuery.isFetching : vehiclesQuery.isFetching;
  const isStale = id ? stateQuery.isStale || configQuery.isStale : vehiclesQuery.isStale;
  const isError = id ? stateQuery.isError || configQuery.isError : vehiclesQuery.isError;

  const isLoading = stateLoading || configLoading;
  const state = stateData?.state;
  const currentVersion = state?.software_version ?? '—';

  const updateVersion = configData?.software_update_version ?? null;
  const rawDownloadPct = configData?.software_update_download_pct;
  const rawInstallPct = configData?.software_update_install_pct;
  const downloadPct = isFiniteNumber(rawDownloadPct) && rawDownloadPct >= 0 && rawDownloadPct <= 100 ? rawDownloadPct : null;
  const installPct = isFiniteNumber(rawInstallPct) && rawInstallPct >= 0 && rawInstallPct <= 100 ? rawInstallPct : null;
  const expectedDuration = configData?.software_update_expected_duration ?? null;
  const scheduledStart = configData?.software_update_scheduled_start ?? null;

  const updateStatus = useMemo<UpdateStatus>(() => {
    if (configData == null) return 'unknown';
    if (!updateVersion) return 'up-to-date';
    if (installPct != null && installPct > 0 && installPct < 100) return 'installing';
    if (downloadPct != null && downloadPct > 0 && downloadPct < 100) return 'downloading';
    if (installPct === 100) return 'installed';
    if (downloadPct === 100) return 'ready';
    return 'available';
  }, [configData, updateVersion, downloadPct, installPct]);

  // Show the body when we have EITHER live vehicle state OR a pending update
  // from the config snapshot. The two queries poll independently, so gating
  // solely on live state (which can lag or drop out) would hide an in-flight
  // update behind the empty state — the update section only needs
  // `updateVersion`, and the current-version row already degrades to "—".
  const hasData = state != null || updateVersion != null;

  const isCompact = size.cols <= 1 && size.rows <= 1;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.softwareUpdate', 'Software update')}
      icon={isCompact ? undefined : <MonitorSmartphone className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
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
      <WidgetBigNumber value={version || '—'} align="center" size="secondary" />
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
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col justify-center gap-2.5">
      {/* Current version row */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <WidgetBigNumber
            label={t('widget.currentVersion', 'Current version')}
            value={version || '—'}
            size="secondary"
          />
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
              sublabel={`${fmtNumber(downloadPct)}%`}
            />
          )}

          {updateStatus === 'installing' && installPct != null && (
            <MetricBar
              value={installPct}
              max={100}
              color="#a78bfa"
              label={t('widget.installing', 'Installing')}
              sublabel={`${fmtNumber(installPct)}%`}
            />
          )}

          {updateStatus === 'ready' && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              <span>{t('widget.readyToInstall', 'Ready to install')}</span>
            </div>
          )}

          {/* Expected duration — shown in tall layout when relevant */}
          {isTall && isFiniteNumber(expectedDuration) && expectedDuration > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] pt-0.5 border-t border-white/[0.06]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {t('widget.estimatedTime', 'Est. time')}: ~{fmtNumber(expectedDuration)}{' '}
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
  const config: Record<UpdateStatus, { variant: 'success' | 'info' | 'warning' | 'neutral'; label: string }> = {
    unknown: { variant: 'neutral', label: t('common:unknown', 'Unknown') },
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
