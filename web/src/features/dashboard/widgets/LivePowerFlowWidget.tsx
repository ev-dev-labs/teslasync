import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Battery, Home, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useTeslaEnergyLiveStatus, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function LivePowerFlowWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const {
    data: sites,
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
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, liveUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  const handleRefresh = useCallback(() => {
    refetchSites();
    if (siteId) refetchLive();
  }, [refetchSites, refetchLive, siteId]);

  const solarW = liveStatus?.solar_power ?? 0;
  const batteryW = liveStatus?.battery_power ?? 0;
  const gridW = liveStatus?.grid_power ?? 0;
  const homeW = liveStatus?.load_power ?? 0;

  // Convert watts → kW for display
  const solarKw = solarW / 1000;
  const batteryKw = batteryW / 1000;
  const gridKw = gridW / 1000;
  const homeKw = homeW / 1000;

  const isCompact = size.cols <= 1;

  const hasData = liveStatus != null;

  const nodes = useMemo<FlowNode[]>(() => {
    if (!hasData) return [];
    return [
      {
        id: 'solar',
        label: t('widget.livePowerFlow.solar', 'Solar'),
        value: Math.abs(solarKw),
        formattedValue: `${fmtNumber(Math.abs(solarKw), 1)} kW`,
        icon: <Sun className="h-3 w-3 text-yellow-400" />,
        position: 'top' as const,
      },
      {
        id: 'grid',
        label: t('widget.livePowerFlow.grid', 'Grid'),
        value: Math.abs(gridKw),
        formattedValue: `${fmtNumber(Math.abs(gridKw), 1)} kW`,
        icon: <Zap className="h-3 w-3 text-blue-400" />,
        position: 'left' as const,
      },
      {
        id: 'home',
        label: t('widget.livePowerFlow.home', 'Home'),
        value: Math.abs(homeKw),
        formattedValue: `${fmtNumber(Math.abs(homeKw), 1)} kW`,
        icon: <Home className="h-3 w-3 text-emerald-400" />,
        position: 'right' as const,
      },
      {
        id: 'battery',
        label: t('widget.livePowerFlow.battery', 'Battery'),
        value: Math.abs(batteryKw),
        formattedValue: `${fmtNumber(Math.abs(batteryKw), 1)} kW`,
        icon: <Battery className="h-3 w-3 text-purple-400" />,
        position: 'bottom' as const,
      },
    ];
  }, [hasData, solarKw, gridKw, homeKw, batteryKw, t]);

  const arrows = useMemo<FlowArrow[]>(() => {
    if (!hasData) return [];

    const result: FlowArrow[] = [];

    // Solar → Home (solar producing)
    if (solarKw > 0) {
      result.push({
        from: 'solar',
        to: 'home',
        value: solarKw,
        active: solarKw > 0.01,
        color: 'text-yellow-400',
      });
    }

    // Solar → Battery (excess solar charging the battery). Tesla live-status
    // reports battery_power in SI watts where a NEGATIVE value means the pack
    // is charging — the canonical convention shared with PowerFlowDashboardPage.
    if (solarKw > 0 && batteryW < 0) {
      result.push({
        from: 'solar',
        to: 'battery',
        value: Math.min(solarKw, Math.abs(batteryKw)),
        active: true,
        color: 'text-yellow-400',
      });
    }

    // Battery → Home (pack discharging to loads, batteryW > 0)
    if (batteryW > 0) {
      result.push({
        from: 'battery',
        to: 'home',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-purple-400',
      });
    }

    // Grid → Home (importing, gridW > 0)
    if (gridW > 0) {
      result.push({
        from: 'grid',
        to: 'home',
        value: gridKw,
        active: true,
        color: 'text-blue-400',
      });
    }

    // Home → Grid (exporting, gridW < 0)
    if (gridW < 0) {
      result.push({
        from: 'home',
        to: 'grid',
        value: Math.abs(gridKw),
        active: true,
        color: 'text-emerald-400',
      });
    }

    // Grid → Battery (pack charging from the grid with no solar available)
    if (batteryW < 0 && solarKw <= 0) {
      result.push({
        from: 'grid',
        to: 'battery',
        value: Math.abs(batteryKw),
        active: true,
        color: 'text-blue-400',
      });
    }

    return result;
  }, [hasData, solarKw, batteryKw, gridKw, homeKw, batteryW, gridW]);

  // No energy sites linked
  if (!hasSites && !isLoading) {
    return (
      <WidgetShell
        loading={false}
        error={null}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={handleRefresh}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          message={t('widget.livePowerFlow.noSite', 'No Tesla Energy site linked')}
          className="py-8"
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.livePowerFlow.title', 'Live Power Flow')}
      loading={isLoading}
      error={null}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetFlowDiagram
        nodes={nodes}
        arrows={arrows}
        compact={isCompact}
        emptyMessage={t('widget.livePowerFlow.noData', 'No live power data')}
      />
    </WidgetShell>
  );
}
