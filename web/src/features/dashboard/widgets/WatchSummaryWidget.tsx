import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Watch, Lock, Unlock } from 'lucide-react';
import { LinearGauge } from '@/components/charts';
import { TimeStamp } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display';
import { AlertBanner, EmptyState, Skeleton } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import { useWatchSummary, useWatchComplication } from '@/api/hooks/useWatch';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatusGrid } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

// Battery state-of-charge health bands → gauge/accent color:
// healthy (>50%) emerald, low (>20%) amber, critical (≤20%) red.
export function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981';
  if (level > 20) return '#f59e0b';
  return '#ef4444';
}

export default function WatchSummaryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const summaryQuery = useWatchSummary(vehicleId);
  const {
    data: summary, isLoading: summaryLoading, isFetching: summaryFetching, isStale: summaryStale, isError: summaryError, dataUpdatedAt: summaryUpdatedAt, refetch: refetchSummary, } = summaryQuery;

  const complicationQuery = useWatchComplication(vehicleId);
  const {
    data: complication, isLoading: compLoading, } = complicationQuery;
  const notConfigured = summaryQuery.availability === 'not-configured';
  const capabilityFailure = summaryQuery.availability === 'prerequisite-error'
    || complicationQuery.availability === 'prerequisite-error';
  const readsBlocked = notConfigured || capabilityFailure;
  const recheckAvailability = useCallback(() => {
    summaryQuery.recheckAvailability?.();
    complicationQuery.recheckAvailability?.();
  }, [summaryQuery, complicationQuery]);

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1;
  const isLoading = !readsBlocked && (summaryLoading || compLoading);

  const batteryLevel = knownNumber(summary?.battery_level);
  const rangeM = summary?.range_m ?? null;
  const state = summary?.state ?? null;
  const stateLabel = state === 'online'
    ? t('widget.watchState.online', 'Online')
    : state === 'asleep'
      ? t('widget.watchState.asleep', 'Asleep')
      : state === 'offline' ? t('widget.watchState.offline', 'Offline') : state;
  const isLocked = summary?.is_locked ?? null;
  const insideTempC = summary?.inside_temp_c ?? null;
  const lastUpdated = summary?.last_updated ?? null;
  const summaryTrust = useDataState({ ...summaryQuery, error: summaryQuery.availabilityError ?? summaryQuery.error, isError: summaryError || summaryQuery.availabilityError != null, isPending: !readsBlocked && summaryQuery.isPending, data: summary ?? (!notConfigured && (summaryLoading || summaryError || summaryQuery.availabilityError) ? undefined : null) }, { provenance: 'cached', unavailable: notConfigured });
  const complicationTrust = useDataState({ ...complicationQuery, error: complicationQuery.availabilityError ?? complicationQuery.error, isError: complicationQuery.isError || complicationQuery.availabilityError != null, isPending: !readsBlocked && complicationQuery.isPending, data: complication ?? (!notConfigured && (compLoading || complicationQuery.isError || complicationQuery.availabilityError) ? undefined : null) }, { provenance: 'cached', unavailable: notConfigured });
  const combined = combineDataStates([summaryTrust, complicationTrust]);
  const dataState = {
    ...combined,
    status: !summary && !complication && isLoading ? 'initial' : combined.status,
    fatalError: capabilityFailure ? null : !summary && summaryTrust.fatalError ? summaryTrust.fatalError : combined.fatalError,
    data: summary,
    hasData: summary != null,
    retry: capabilityFailure ? recheckAvailability : notConfigured ? null : () => { void refetchSummary(); void complicationQuery.refetch?.(); },
  } satisfies Parameters<typeof WidgetShell>[0]['dataState'];

  const displayRange = useMemo(() => {
    if (rangeM == null) return null;
    return convertDistanceFromSI(rangeM, distanceUnit);
  }, [rangeM, distanceUnit]);

  const measurementMetrics: readonly StatMetric[] = [
    {
      metricId: 'distance',
      occurrenceId: 'watch-summary-range',
      rawValue: rangeM,
      label: t('widget.range', 'Range'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
    },
    {
      metricId: 'temperature',
      occurrenceId: 'watch-summary-cabin',
      rawValue: insideTempC,
      label: t('widget.cabinTemp', 'Cabin'),
      display: { formatter: raw => ({ value: fmtNumber(convertTempFromSI(raw, tempUnit)), unit: tempUnit }) },
    },
  ];

  const color = useMemo(
    () => (batteryLevel != null ? getBatteryColor(batteryLevel) : '#374151'),
    [batteryLevel],
  );

  const handleRefresh = useCallback(() => {
    if (capabilityFailure) {
      recheckAvailability();
      return;
    }
    if (notConfigured) return;
    void refetchSummary();
    void complicationQuery.refetch?.();
  }, [capabilityFailure, recheckAvailability, notConfigured, refetchSummary, complicationQuery]);

  const hasData = summary != null;
  const capabilityState = capabilityFailure ? (
    <AlertBanner
      variant="danger"
      role="alert"
      title={t('watch:capability.readError', 'Watch access could not be checked')}
    >
      <Text as="p" variant="bodySm" color="secondary">
        {t('watch:capability.readErrorDescription', 'Watch access is unknown because browser session storage could not be read or saved. Retry after storage becomes available. Retained readings remain visible.')}
      </Text>
      <Button type="button" variant="secondary" size="sm" wrapLabel className="mt-2 min-h-11" onClick={recheckAvailability}>
        {t('error:retry', 'Retry')}
      </Button>
    </AlertBanner>
  ) : notConfigured ? (
    <EmptyState
      className="px-0 py-2"
      message={t('watch:capability.notConfigured', 'Watch access is not configured')}
      description={t('watch:capability.description', 'Watch readings require a wearable API key in this session. Manage API keys and open your configured watch link to enable readings. Retained readings are not refreshed until access is configured.')}
      actionTo={{ to: '/api-keys', label: t('watch:capability.configure', 'Manage API keys') }}
    />
  ) : null;

  // Compact (1×2): Watch-face circular display
  if (isCompact) {
    const isCharging = complication?.charging === true || summary?.is_charging === true;
    const compactStatusParts: string[] = [];
    if (isCharging) compactStatusParts.push(t('widget.charging', 'Charging'));
    if (isLocked != null) {
      compactStatusParts.push(isLocked
        ? t('widget.locked', 'Locked')
        : t('widget.unlocked', 'Unlocked'));
    }
    const compactStatus = compactStatusParts.join(' · ');

    return (
      <WidgetShell
        title={t('widget.watchSummary', 'Watch summary')}
        loading={isLoading}
        dataState={dataState}
        loadingContent={<div className="flex flex-col gap-2"><Skeleton className="h-16" /><Skeleton className="h-11" /></div>}
        updatedAt={combined.updatedAt ?? summaryUpdatedAt}
        isFetching={combined.isRefreshing || summaryFetching}
        isStale={summaryStale}
        isError={summaryError || capabilityFailure}
        onRefresh={notConfigured ? undefined : handleRefresh}
      >
          {capabilityState}
          <div className="h-full flex flex-col items-center justify-center gap-1.5 py-1">
            <div className="w-full">
              {batteryLevel == null ? <WidgetBigNumber value={null} label={t('widget.battery', 'Battery')} /> : <LinearGauge
                preserveReadingAndScale
                value={batteryLevel}
                max={100}
                label=""
                ariaLabel={t('widget.battery', 'Battery')}
                unit="%"
                color={color}
                size={80}
                decimals={displayPrecision}
              />}
            </div>
            {displayRange != null && (
              <span className={dashboardTokens.metricLabel}>
                {fmtNumber(displayRange)} {distanceUnit}
              </span>
            )}
            {compactStatus && (
              <span className={dashboardTokens.metricLabel}>
                {compactStatus}
              </span>
            )}
            {!readsBlocked && !hasData && !summaryLoading && <p className={dashboardTokens.metricLabel}>{t('widget.noWatchData', 'No watch data')}</p>}
          </div>
      </WidgetShell>
    );
  }

  // Standard (2×2+): Full watch summary with all fields
  return (
    <WidgetShell
      title={t('widget.watchSummary', 'Watch summary')}
      icon={<Watch className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<div className="flex flex-col gap-3"><Skeleton className="h-16" /><Skeleton className="h-24" /></div>}
      updatedAt={combined.updatedAt ?? summaryUpdatedAt}
      isFetching={combined.isRefreshing || summaryFetching}
      isStale={summaryStale}
      isError={summaryError || capabilityFailure}
      onRefresh={notConfigured ? undefined : handleRefresh}
    >
        {capabilityState}
        <div className="h-full flex flex-col gap-3">
          {/* Hero: Battery big number */}
          <WidgetBigNumber
            value={batteryLevel == null ? null : fmtNumber(batteryLevel)}
            unit="%"
            label={t('widget.battery', 'Battery')}
            badge={
              stateLabel
                ? {
                    text: stateLabel,
                    variant: state === 'online' ? 'success' : state === 'asleep' ? 'neutral' : 'warning',
                  }
                : undefined
            }
          />

          <DashboardSourceBrief
            metrics={measurementMetrics}
            state={summaryTrust}
            eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
            title={t('widget.watchMeasurementsTitle', 'Returned watch measurements')}
            description={t('widget.watchMeasurementsDescription', 'Range and cabin temperature come only from the watch summary; battery, vehicle state, lock and charging indicators remain separate.')}
            scope={t('widget.watchMeasurementsScope', 'Requested vehicle {{id}} · returned watch summary snapshot; complication freshness does not establish measurement freshness or continuous recording coverage.', { id: vehicleId ?? t('widget.watchDefaultVehicle', 'default') })}
            testId="dashboard-watch-measurements-brief"
          />
          <WidgetStatusGrid cols={2} cells={[
            {
              id: 'lock',
              label: t('widget.lockStatus', 'Lock'),
              status: isLocked == null ? 'unknown' : isLocked ? 'ok' : 'warning',
              icon: isLocked === false ? <Unlock className="size-4" /> : <Lock className="size-4" />,
              statusLabel: isLocked == null ? '—' : isLocked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked'),
            },
            {
              id: 'charging',
              label: t('widget.charging', 'Charging'),
              status: complication?.charging == null ? 'unknown' : complication.charging ? 'ok' : 'inactive',
              statusLabel: complication?.charging == null
                ? t('widget.status.unknown', 'Unknown')
                : complication.charging
                  ? t('widget.charging', 'Charging')
                  : t('widget.status.inactive', 'Inactive'),
            },
          ]} />
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className={dashboardTokens.metricLabel}>{t('widget.lastSeen', 'Last seen')}</span>
              <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                <TimeStamp value={lastUpdated} className={dashboardTokens.metricLabel} />
              </span>
            </div>
          {!readsBlocked && !hasData && !summaryLoading && <p className={dashboardTokens.metricLabel}>{t('widget.noWatchData', 'No watch data')}</p>}
        </div>
    </WidgetShell>
  );
}
