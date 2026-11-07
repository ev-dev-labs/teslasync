import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Battery, Home, Zap } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTeslaEnergyLiveStatus, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { WidgetBigNumber, WidgetFlowDiagram, WidgetStatGrid, type FlowNode, type FlowArrow } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

export default function LivePowerFlowWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatPower } = useUnits();
  const { formatDateTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting();
  const compact = size.cols === 1 || size.rows === 1;

  const {
    data: sites,
    error: sitesError,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  const {
    data: liveStatus,
    error: liveError,
    isLoading: liveLoading,
    isFetching: liveFetching,
    isStale: liveStale,
    isError: liveIsError,
    dataUpdatedAt: liveUpdatedAt,
    refetch: refetchLive,
  } = useTeslaEnergyLiveStatus(siteId);

  const isLoading = sitesLoading || (!!siteId && liveLoading);
  const isFetching = sitesFetching || liveFetching;
  const isStale = sitesStale || liveStale;
  const isError = sitesIsError || liveIsError;
  const updatedAt = siteId ? liveUpdatedAt : sitesUpdatedAt;

  const hasSites = (sites ?? []).length > 0;

  const handleRefresh = useCallback(() => {
    refetchSites();
    if (siteId) refetchLive();
  }, [refetchSites, refetchLive, siteId]);

  const solarW = knownNumber(liveStatus?.solar_power);
  const batteryW = knownNumber(liveStatus?.battery_power);
  const gridW = knownNumber(liveStatus?.grid_power);
  const homeW = knownNumber(liveStatus?.load_power);
  const measuredBatteryPercent = knownNumber(liveStatus?.percentage_charged);
  const batteryPercent = measuredBatteryPercent != null && measuredBatteryPercent >= 0 && measuredBatteryPercent <= 100
    ? measuredBatteryPercent : null;

  // Diagram weights use kW magnitudes; labels use the user's formatter.
  const solarKw = solarW == null ? null : solarW / 1000;
  const batteryKw = batteryW == null ? null : batteryW / 1000;
  const gridKw = gridW == null ? null : gridW / 1000;
  const homeKw = homeW == null ? null : homeW / 1000;

  const hasData = liveStatus != null;
  const observedAt = Date.parse(liveStatus?.timestamp ?? '');
  const hasFreshFlow = Number.isFinite(observedAt) && observedAt > 0
    && Date.now() - observedAt <= 120_000 && observedAt <= Date.now() + 5_000;
  const dataState = useDataState({
    data: hasData ? liveStatus : isLoading || isError ? undefined : null,
    error: liveError ?? sitesError,
    isError,
    isFetching,
    dataUpdatedAt: siteId ? liveUpdatedAt : sitesUpdatedAt,
    refetch: handleRefresh,
  }, {
    provenance: 'cached',
    maxAgeMs: hasData ? 120_000 : undefined,
    partial: hasData && [solarW, batteryW, gridW, homeW, batteryPercent].some((value) => value == null),
  });

  const nodes = useMemo<FlowNode[]>(() => {
    if (!hasData) return [];
    return [
      {
        id: 'solar',
        label: t('widget.livePowerFlow.solar', 'Solar'),
        value: Math.abs(solarKw ?? 0),
        formattedValue: '',
        icon: <Sun className="h-3 w-3 text-yellow-400" />,
        position: 'top' as const,
      },
      {
        id: 'grid',
        label: t('widget.livePowerFlow.grid', 'Grid'),
        value: Math.abs(gridKw ?? 0),
        formattedValue: '',
        icon: <Zap className="h-3 w-3 text-theme-accent" />,
        position: 'left' as const,
      },
      {
        id: 'home',
        label: t('widget.livePowerFlow.home', 'Home'),
        value: Math.abs(homeKw ?? 0),
        formattedValue: '',
        icon: <Home className="h-3 w-3 text-emerald-400" />,
        position: 'right' as const,
      },
      {
        id: 'battery',
        label: t('widget.livePowerFlow.battery', 'Battery'),
        value: batteryPercent ?? 0,
        formattedValue: batteryPercent == null ? '—' : `${fmtInt(batteryPercent)}%`,
        icon: <Battery className="h-3 w-3 text-purple-400" />,
        position: 'bottom' as const,
      },
      {
        id: 'site',
        label: '',
        value: 0,
        formattedValue: '',
        icon: <Zap className="h-3 w-3" />,
        position: 'center' as const,
      },
    ];
  }, [hasData, solarKw, gridKw, homeKw, batteryPercent, fmtInt, t]);

  const arrows = useMemo<FlowArrow[]>(() => {
    if (!hasData) return [];

    const result: FlowArrow[] = [];

    // Net meter readings describe connections to the site bus, not the
    // allocation of solar/grid energy to individual loads or the battery.
    if (solarKw != null && solarKw !== 0) {
      result.push({
        from: solarKw > 0 ? 'solar' : 'site',
        to: solarKw > 0 ? 'site' : 'solar',
        value: Math.abs(solarKw),
        active: true,
        color: 'text-yellow-400',
        label: formatPower(Math.abs(solarW ?? 0)),
      });
    }

    // Tesla's negative battery power is charging; positive is discharging.
    if (batteryKw != null && batteryKw > 0) {
      result.push({
        from: 'battery',
        to: 'site',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-purple-400',
        label: formatPower(Math.abs(batteryW ?? 0)),
      });
    }

    if (batteryKw != null && batteryKw < 0) {
      result.push({
        from: 'site',
        to: 'battery',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-purple-400',
        label: formatPower(Math.abs(batteryW ?? 0)),
      });
    }

    if (gridKw != null && gridKw > 0) {
      result.push({
        from: 'grid',
        to: 'site',
        value: gridKw,
        active: true,
        color: 'text-status-info',
        label: formatPower(Math.abs(gridW ?? 0)),
      });
    }

    if (gridKw != null && gridKw < 0) {
      result.push({
        from: 'site',
        to: 'grid',
        value: Math.abs(gridKw),
        active: true,
        color: 'text-emerald-400',
        label: formatPower(Math.abs(gridW ?? 0)),
      });
    }

    if (homeKw != null && homeKw !== 0) {
      result.push({
        from: homeKw > 0 ? 'site' : 'home',
        to: homeKw > 0 ? 'home' : 'site',
        value: Math.abs(homeKw),
        active: true,
        color: 'text-emerald-400',
        label: formatPower(Math.abs(homeW ?? 0)),
      });
    }

    return result;
  }, [hasData, solarW, batteryW, gridW, homeW, solarKw, batteryKw, gridKw, homeKw, formatPower]);

  // No energy sites linked
  if (!hasSites && !isLoading) {
    const empty = (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        message={t('widget.livePowerFlow.noSite', 'No Tesla energy site linked')}
        className="py-8"
      />
    );
    return (
      <WidgetShell
        title={t('widget.livePowerFlow.title', 'Live power flow')}
        dataState={dataState}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={handleRefresh}
      >
        <InstrumentPresentation family="siteflow" compact={compact} instrument={empty}>
          {empty}
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  const diagram = (
    <div className="widget-flow-frame flex h-full min-h-0 w-full items-center" data-motion-suppressed={!hasFreshFlow || undefined}>
      <WidgetFlowDiagram
        nodes={nodes}
        arrows={arrows}
        compact={false}
        ariaLabel={`${t('widget.livePowerFlow.title', 'Live power flow')}: ${nodes.map((node) => `${node.label} ${node.formattedValue}`).join(', ')}; ${arrows.map((arrow) => `${nodes.find((node) => node.id === arrow.from)?.label} → ${nodes.find((node) => node.id === arrow.to)?.label}`).join(', ')}`}
        emptyMessage={t('widget.livePowerFlow.noData', 'No live power data')}
      />
    </div>
  );
  const context = (
    <div className="flex min-w-0 flex-col gap-1">
      <Caption>{t('widget.energySiteInfo.title', 'Energy site')} · {(sites ?? [])[0]?.site_name || '—'}</Caption>
      {Number.isFinite(observedAt) && observedAt > 0 && (
        <Caption><time dateTime={liveStatus?.timestamp}>{t('dashboardWidgets.energy.livePowerFlow.observedAt', 'Observed {{time}}', {
          time: formatDateTime(liveStatus?.timestamp),
        })}</time></Caption>
      )}
      {hasData && !hasFreshFlow && (
        <Caption>{t('dashboardWidgets.energy.livePowerFlow.snapshotNotCurrent', 'Snapshot is stale or its observation time is unverified.')}</Caption>
      )}
    </div>
  );
  const details = (
    <div className="space-y-3">
      <WidgetStatGrid cols={compact ? 2 : 4} stats={[
        { label: t('widget.livePowerFlow.home', 'Home'), value: homeW == null ? null : formatPower(homeW) },
        { label: t('widget.livePowerFlow.grid', 'Grid'), value: gridW == null ? null : formatPower(gridW) },
        { label: t('widget.livePowerFlow.battery', 'Battery'), value: batteryW == null ? null : formatPower(batteryW) },
        { label: t('dashboardWidgets.energy.livePowerFlow.batteryLevel', 'Battery level'), value: batteryPercent == null ? null : `${fmtInt(batteryPercent)}%` },
      ]} />
      <Caption as="p">{t('dashboardWidgets.energy.livePowerFlow.siteConnections', 'Connections show measured flow at the site, not source-to-load allocation.')}</Caption>
    </div>
  );

  return (
    <WidgetShell
      title={t('widget.livePowerFlow.title', 'Live power flow')}
      loading={isLoading}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      dataState={dataState}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation family="siteflow" compact={compact} context={context}
        headline={<WidgetBigNumber value={solarW == null ? null : formatPower(solarW)}
          label={solarW != null && solarW >= 0 ? t('widget.solarProduction.title', 'Solar production') : t('widget.livePowerFlow.solar', 'Solar')}
          animated={false} />}
        icon={<Sun />} instrument={diagram} details={details}>
        {diagram}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
