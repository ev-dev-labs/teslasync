import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Battery, Home, Zap } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTeslaEnergyLiveStatus, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function LivePowerFlowWidget({}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatPower } = useUnits();
  const { fmtInt } = useNumberFormatting();

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
  const batteryPercent = knownNumber(liveStatus?.percentage_charged);

  // Diagram weights use kW magnitudes; labels use the user's formatter.
  const solarKw = solarW == null ? null : solarW / 1000;
  const batteryKw = batteryW == null ? null : batteryW / 1000;
  const gridKw = gridW == null ? null : gridW / 1000;
  const homeKw = homeW == null ? null : homeW / 1000;

  const hasData = liveStatus != null;
  const dataState = useDataState({
    data: hasData ? liveStatus : isLoading || isError ? undefined : null,
    error: liveError ?? sitesError,
    isError,
    isFetching,
    dataUpdatedAt: siteId ? liveUpdatedAt : sitesUpdatedAt,
    refetch: handleRefresh,
  }, {
    provenance: 'cached',
    partial: hasData && [solarW, batteryW, gridW, homeW].some((value) => value == null),
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
        icon: <Zap className="h-3 w-3 text-blue-400" />,
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
        color: 'text-blue-400',
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
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={t('widget.livePowerFlow.noSite', 'No Tesla energy site linked')}
          className="py-8"
        />
      </WidgetShell>
    );
  }

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
      <div className="mx-auto h-full min-h-0 w-full max-w-72 px-5 py-7 [&>svg]:overflow-visible [&_text]:fill-[var(--text-secondary)] [&_circle]:fill-[var(--surface-2)] [&_circle]:stroke-[var(--border-default)] motion-reduce:[&_.flow-active]:animate-none">
        <WidgetFlowDiagram
          nodes={nodes}
          arrows={arrows}
          compact={false}
          ariaLabel={`${t('widget.livePowerFlow.title', 'Live power flow')}: ${nodes.map((node) => `${node.label} ${node.formattedValue}`).join(', ')}; ${arrows.map((arrow) => `${nodes.find((node) => node.id === arrow.from)?.label} → ${nodes.find((node) => node.id === arrow.to)?.label}`).join(', ')}`}
          emptyMessage={t('widget.livePowerFlow.noData', 'No live power data')}
        />
      </div>
    </WidgetShell>
  );
}
