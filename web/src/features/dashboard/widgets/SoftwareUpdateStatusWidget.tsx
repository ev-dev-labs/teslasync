import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { MetricBar } from '@/components/data-display';
import { useVehicles, useVehicleState, useVehicleConfigLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { WidgetBigNumber } from './shared';
import { SoftwareUpdateBadge, type UpdateStatus } from '../components/continuation-dashboard-3/SoftwareUpdateBadge';

export default function SoftwareUpdateStatusWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
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
      icon={isCompact ? undefined : <MonitorSmartphone className="h-3.5 w-3.5 text-cyan-300" />}
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
            <div className="h-full min-w-0 flex flex-col items-center justify-center gap-1.5 px-1">
              <MonitorSmartphone className="h-5 w-5 text-cyan-300" aria-hidden="true" />
              <WidgetBigNumber value={currentVersion} align="center" size="secondary" />
              <SoftwareUpdateBadge status={updateStatus} />
            </div>
          ) : (
            <div className="h-full min-w-0 flex flex-col justify-center gap-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <WidgetBigNumber
                  label={t('widget.currentVersion', 'Current version')}
                  value={currentVersion}
                  size="primary"
                />
                <SoftwareUpdateBadge status={updateStatus} />
              </div>

              {updateVersion && updateStatus !== 'up-to-date' ? (
                <div className="min-w-0 space-y-2.5">
                  <div className="min-w-0">
                    <span className="text-sm text-[var(--text-secondary)]">
                      {t('widget.updateAvailable', 'Update available')}
                    </span>
                    <span className="ms-1 text-sm font-semibold text-cyan-300 [overflow-wrap:anywhere]">
                      {updateVersion}
                    </span>
                  </div>

                  {updateStatus === 'downloading' && downloadPct != null && (
                    <MetricBar
                      value={downloadPct}
                      max={100}
                      color="var(--theme-primary)"
                      label={t('widget.downloading', 'Downloading')}
                      sublabel={`${fmtNumber(downloadPct, 0)}%`}
                      size="default"
                    />
                  )}
                  {updateStatus === 'installing' && installPct != null && (
                    <MetricBar
                      value={installPct}
                      max={100}
                      color="var(--theme-primary)"
                      label={t('widget.installing', 'Installing')}
                      sublabel={`${fmtNumber(installPct, 0)}%`}
                      size="default"
                    />
                  )}
                  {updateStatus === 'ready' && (
                    <p className="text-sm font-medium text-emerald-300">
                      {t('widget.readyToInstall', 'Ready to install')}
                    </p>
                  )}

                  {size.rows >= 2 && isFiniteNumber(expectedDuration) && expectedDuration > 0 && (
                    <p className="border-t border-[var(--border-subtle)] pt-2 text-sm text-[var(--text-secondary)]">
                      {t('widget.estimatedTime', 'Est. time')}: ~{fmtNumber(expectedDuration, 0)}{' '}
                      {t('widget.minutes', 'min')}
                    </p>
                  )}
                  {size.rows >= 2 && scheduledStart && (
                    (() => {
                      const scheduledDate = new Date(scheduledStart);
                      const scheduledText = Number.isNaN(scheduledDate.getTime())
                        ? null
                        : formatDateTime(scheduledDate);
                      return scheduledText ? (
                        <p className="border-t border-[var(--border-subtle)] pt-2 text-sm text-[var(--text-secondary)]">
                          {t('widget.scheduledStart', 'Scheduled')}: {scheduledText}
                        </p>
                      ) : null;
                    })()
                  )}
                </div>
              ) : updateStatus === 'up-to-date' ? (
                <p className="text-sm font-medium text-emerald-300">
                  {t('widget.upToDate', 'Up to date')}
                </p>
              ) : null}
            </div>
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
