import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import { useTeslaEnergySites, useTeslaEnergySiteInfo } from '@/api/hooks/useEnergy';
import { knownNumber, knownString } from '@/api/dataState';
import { DataProvenanceBadge } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function EnergySiteInfoWidget({ size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatPower, formatEnergy } = useUnits();
  const isCompact = size.cols <= 1;

  const {
    data: sites,
    isLoading: sitesLoading,
    error: sitesError,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  const {
    data: infoResponse,
    isLoading: infoLoading,
    error: infoError,
    isFetching: infoFetching,
    isStale: infoStale,
    isError: infoIsError,
    dataUpdatedAt: infoUpdatedAt,
    refetch: refetchInfo,
  } = useTeslaEnergySiteInfo(siteId);

  const isLoading = sitesLoading || (!!siteId && infoLoading);
  const isFetching = sitesFetching || infoFetching;
  const isStale = sitesStale || infoStale;
  const isError = sitesIsError || infoIsError;
  const updatedAt = siteId ? infoUpdatedAt : sitesUpdatedAt;

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchInfo();
  };

  const info = infoResponse?.data ?? null;
  const hasSites = (sites ?? []).length > 0;
  const error = sitesError ?? infoError;
  const dataState = useDataState({
    data: siteId ? info ?? (isLoading || isError || error ? undefined : null)
      : isLoading || isError || error ? undefined : sites ?? null,
    error,
    isError,
    isFetching,
    dataUpdatedAt: siteId ? infoUpdatedAt : sitesUpdatedAt,
    refetch: handleRefresh,
  }, { provenance: 'cached', partial: !!info && [
    info.nameplate_power, info.nameplate_energy, info.battery_count,
  ].some((value) => knownNumber(value) == null) });

  // `installation_time_zone` is a timezone string (location context), not a
  // date — surfaced under the "Installation Timezone" label below.
  const installTimezone = knownString(info?.installation_time_zone);

  const solarPower = formatPower(knownNumber(info?.nameplate_power));

  const batteryCount = knownNumber(info?.battery_count);
  const batteryCapacity = knownNumber(info?.nameplate_energy);
  const batteryEnergy = formatEnergy(batteryCapacity);

  const gatewayFirmware = knownString(info?.version);

  // Build entries for WidgetDetailCard
  const entries: DetailEntry[] = [];

  if (!hasSites && !isLoading) {
    // No sites — show empty via WidgetDetailCard (entries is [])
  } else if (info) {
    entries.push({
      id: 'solar',
      label: t('widget.energySiteInfo.solarSize', 'Solar system'),
      value: solarPower,
    });
    entries.push({
      id: 'powerwalls',
      label: t('widget.energySiteInfo.powerwall', 'Powerwalls'),
      // nameplate_energy is the site's total capacity, not capacity per pack.
      value: batteryCount == null && batteryCapacity == null
        ? '—' : `${batteryCount == null ? '—' : fmtInt(batteryCount)} · ${batteryEnergy}`,
    });
    entries.push({
      id: 'firmware',
      label: t('widget.energySiteInfo.firmware', 'Gateway firmware'),
      value: gatewayFirmware,
      mono: true,
    });
    entries.push({
      id: 'timezone',
      label: t('widget.energySiteInfo.timezone', 'Installation timezone'),
      value: installTimezone,
    });
  }

  return (
    <WidgetShell
      title={t('widget.energySiteInfo.title', 'Energy site')}
      icon={<Home className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
      status={!isCompact && <DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="h-full min-w-0">
        <WidgetDetailCard
          entries={entries}
          compact={isCompact}
          emptyMessage={
            !hasSites
              ? t('widget.energySiteInfo.noSite', 'No Tesla energy site linked')
              : t('widget.energySiteInfo.noData', 'No site info available')
          }
          emptyIcon={<Home className="h-5 w-5" />}
        />
      </div>
    </WidgetShell>
  );
}
