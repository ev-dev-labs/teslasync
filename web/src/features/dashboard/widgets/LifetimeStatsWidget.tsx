import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { useLifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { knownNumber } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function LifetimeStatsWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useLifetimeStats(id > 0 ? String(id) : undefined);
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const dataState = useDataState(query, { provenance: 'historical' });
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const isCompact = size.cols <= 1;
  const distanceKm = knownNumber(data?.total_distance_km);
  const distanceMeters = distanceKm == null ? null : distanceKm * 1000;
  const displayDistance = distanceMeters == null
    ? null
    : convertDistanceFromSI(distanceMeters, unitPrefs.distance);

  const stats: StatGridItem[] = [
    {
      label: t('widget.lifetimeStats.totalDistance', 'Total distance'),
      value: displayDistance == null ? null : fmtInt(displayDistance),
      unit: distanceUnit,
    },
    {
      label: t('widget.lifetimeStats.totalDrives', 'Total drives'),
      value: knownNumber(data?.total_drives) == null ? null : fmtInt(data?.total_drives),
      unit: undefined,
    },
    {
      label: t('widget.lifetimeStats.totalEnergy', 'Total energy'),
      value: knownNumber(data?.total_energy_kwh) == null ? null : fmtInt(data?.total_energy_kwh),
      unit: 'kWh',
    },
    {
      label: t('widget.lifetimeStats.co2Saved', 'CO₂ saved'),
      value: knownNumber(data?.co2_offset_kg) == null
        ? null
        : fmtNumber((data?.co2_offset_kg ?? 0) / 1000, 1),
      unit: 't',
    },
    {
      label: t('widget.lifetimeStats.ownershipDays', 'Owned'),
      value: knownNumber(data?.ownership_days) == null ? null : fmtInt(data?.ownership_days),
      unit: t('widget.lifetimeStats.days', 'days'),
    },
  ];

  const shellProps = {
    title: t('widget.lifetimeStats.title', 'Lifetime stats'),
    dataState: data != null || isLoading || isError ? dataState : undefined,
    loading: isLoading,
    error: isError && data == null
      ? String(error ?? t('widget.lifetimeStats.error', 'Unable to load lifetime stats'))
      : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
      >
        {data != null ? (
          <WidgetBigNumber
            value={displayDistance == null ? null : fmtInt(displayDistance)}
            unit={distanceUnit}
            label={t('widget.lifetimeStats.totalDistance', 'Total distance')}
            subtitle={t('widget.lifetimeStats.lifetime', 'Lifetime')}
            align="start"
          />
        ) : (
          <EmptyState
            icon={<Trophy className="h-5 w-5" />}
            message={t('widget.lifetimeStats.noData', 'No lifetime data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={<Trophy className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      {...shellProps}
    >
      {data != null ? (
        <WidgetStatGrid stats={stats} cols={3} />
      ) : (
        <EmptyState
          icon={<Trophy className="h-5 w-5" />}
          message={t('widget.lifetimeStats.noData', 'No lifetime data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
