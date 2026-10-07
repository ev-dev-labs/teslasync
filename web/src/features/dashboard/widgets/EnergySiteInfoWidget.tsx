import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import { useTeslaEnergySites, useTeslaEnergySiteInfo } from '@/api/hooks/useEnergy';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function EnergySiteInfoWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
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
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, infoUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchInfo();
  };

  const info = infoResponse?.data ?? null;
  const hasSites = (sites ?? []).length > 0;

  // `installation_time_zone` is a timezone string (location context), not a
  // date — surfaced under the "Installation Timezone" label below.
  const installTimezone = info?.installation_time_zone ?? null;

  const solarKw = info?.nameplate_power != null
    ? fmtNumber(info.nameplate_power / 1000, 1)
    : null;

  const batteryCount = info?.battery_count ?? 0;
  const batteryKwh = info?.nameplate_energy != null
    ? fmtNumber(info.nameplate_energy / 1000, 1)
    : null;

  const gatewayFirmware = info?.version ?? null;

  // Build entries for WidgetDetailCard
  const entries: DetailEntry[] = [];

  if (!hasSites && !isLoading) {
    // No sites — show empty via WidgetDetailCard (entries is [])
  } else if (info) {
    entries.push({
      label: t('widget.energySiteInfo.solarSize', 'Solar System'),
      value: solarKw != null ? `${solarKw} kW` : '—',
    });
    entries.push({
      label: t('widget.energySiteInfo.powerwall', 'Powerwalls'),
      value: batteryCount > 0
        ? `${fmtInt(batteryCount)} × ${batteryKwh ?? '—'} kWh`
        : '—',
    });
    entries.push({
      label: t('widget.energySiteInfo.firmware', 'Gateway Firmware'),
      value: gatewayFirmware,
      mono: true,
    });
    entries.push({
      label: t('widget.energySiteInfo.timezone', 'Installation Timezone'),
      value: installTimezone,
    });
  }

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.energySiteInfo.title', 'Energy Site')}
      icon={isCompact ? undefined : <Home className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={
        sitesError ? String(sitesError) : infoError ? String(infoError) : null
      }
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetDetailCard
        entries={entries}
        compact={isCompact}
        emptyMessage={
          !hasSites
            ? t('widget.energySiteInfo.noSite', 'No Tesla Energy site linked')
            : t('widget.energySiteInfo.noData', 'No site info available')
        }
        emptyIcon={<Home className="h-5 w-5" />}
      />
    </WidgetShell>
  );
}
