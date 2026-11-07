import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { EmptyState, QueryError } from '@/components/feedback';
import { MetricLabel, MetricValue } from '@/components/ui';
import { useLocations } from '@/api/hooks/useLocations';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState, useCombinedDataState } from '@/hooks/useDataState';

export function locationBadge(
  snapshot: { located_at_home?: boolean; located_at_work?: boolean; located_at_favorite?: boolean } | null | undefined,
  t: (key: string, fallback: string) => string,
): { emoji: string; label: string; variant: 'success' | 'warning' | 'error' | 'neutral' } {
  if (snapshot?.located_at_home) return { emoji: '🏠', label: t('widget.locationFavorites.home', 'Home'), variant: 'success' };
  if (snapshot?.located_at_work) return { emoji: '🏢', label: t('widget.locationFavorites.work', 'Work'), variant: 'neutral' };
  if (snapshot?.located_at_favorite) return { emoji: '⭐', label: t('widget.locationFavorites.favorite', 'Favorite'), variant: 'neutral' };
  return { emoji: '📍', label: t('widget.locationFavorites.other', 'Other'), variant: 'warning' };
}

export default function LocationFavoritesWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const locationsQuery = useLocations(vehicleIdStr);
  const {
    data: locations,
    isLoading: locLoading,
    isFetching: locFetching,
    isStale: locStale,
    isError: locIsError,
    dataUpdatedAt: locUpdatedAt,
    refetch: locRefetch,
  } = locationsQuery;

  const snapshotQuery = useLocationSnapshotLatest(vid ?? 0);
  const {
    data: snapshot,
    isLoading: snapLoading,
    isFetching: snapFetching,
    isStale: snapStale,
    isError: snapIsError,
    dataUpdatedAt: snapUpdatedAt,
    refetch: snapRefetch,
  } = snapshotQuery;
  const locationsState = useDataState({
    ...locationsQuery,
    data: locIsError && (!Array.isArray(locations) || locations.length === 0) ? undefined : locations,
  });
  const snapshotState = useDataState({
    ...snapshotQuery,
    data: snapIsError && !snapshot ? undefined : snapshot,
  });
  const combinedState = useCombinedDataState([locationsState, snapshotState]);

  const isLoading = locLoading || snapLoading;
  const isFetching = locFetching || snapFetching;
  const isStale = locStale || snapStale;
  const isError = locIsError || snapIsError;
  const updatedAt = Math.max(locUpdatedAt ?? 0, snapUpdatedAt ?? 0);

  const isCompact = size.cols <= 1;

  const items: RankedItem[] = useMemo(() => {
    const locs = Array.isArray(locations) ? locations : [];
    return locs.filter((loc) => loc != null).map((loc) => {
      const visits = loc.visitCount != null && Number.isSafeInteger(loc.visitCount) && loc.visitCount >= 0
        ? loc.visitCount
        : null;
      const label = loc.addressName ?? '—';
      const destinationName = snapshot?.destination_name?.trim();
      const matchesDestination = destinationName != null && destinationName.length > 0 &&
        label.localeCompare(destinationName, undefined, { sensitivity: 'accent' }) === 0;
      const matchesPresence = matchesDestination;
      const hereNow = matchesPresence && !snapIsError && !snapStale && !snapshotState.isRefreshBlocked && (
        snapshot?.located_at_home === true ||
        snapshot?.located_at_work === true ||
        snapshot?.located_at_favorite === true
      );
      const visitsText = visits == null
        ? t('widget.locationFavorites.unknownVisits', 'Visit count unavailable')
        : t('widget.locationFavorites.visits', '{{count}} visits', { count: visits });

      return {
        id: loc.id,
        label,
        value: visits,
        formattedValue: '',
        sublabel: hereNow
          ? `${t('widget.locationFavorites.hereNow', 'Here now')} · ${visitsText}`
          : visitsText,
        badge: hereNow ? {
          text: t('widget.locationFavorites.current', 'Current'),
          variant: 'success' as const,
        } : undefined,
      };
    }).sort((a, b) => {
      if (a.value == null) return b.value == null ? 0 : 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }, [locations, snapshot, snapIsError, snapStale, snapshotState.isRefreshBlocked, t]);

  // Both queries feed the ranked rows; refreshing either source updates the card.
  const handleRefresh = useCallback(() => {
    locRefetch();
    snapRefetch();
  }, [locRefetch, snapRefetch]);

  const shellProps = {
    title: t('widget.locationFavorites.title', 'Favorite locations'),
    loading: isLoading,
    dataState: {
      ...combinedState,
      retry: handleRefresh,
      data: locations ?? snapshot,
      hasData: items.length > 0 || snapshot != null,
      status: isLoading && items.length === 0 && !snapshot ? 'initial' as const : combinedState.status,
    },
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  const listProps = {
    order: 'source' as const,
    wrapContent: true,
    compact: isCompact,
    emptyMessage: t('widget.locationFavorites.noData', 'No favorite locations'),
    emptyIcon: <MapPin className="h-5 w-5" />,
  };
  const snapshotError = snapshotState.fatalError && (
    <QueryError error={snapshotState.fatalError} onRetry={() => { void snapRefetch(); }} />
  );
  const locationsError = locationsState.fatalError && (
    <QueryError error={locationsState.fatalError} onRetry={() => { void locRefetch(); }} />
  );
  const empty = (
    <EmptyState /* no-action: favorites are derived from visited locations; both sources refresh from the shell */
      variant={isCompact ? 'informational' : undefined}
      icon={<MapPin className="h-5 w-5" />}
      message={listProps.emptyMessage}
      className="py-4"
    />
  );
  const classicList = items.length > 0 ? <WidgetRankedList {...listProps} items={items} /> : empty;
  const packItems = items.map((item) => ({
    ...item,
    formattedValue: item.value == null
      ? '—'
      : t('widget.locationFavorites.visits', '{{count}} visits', { count: item.value }),
    sublabel: item.value == null ? item.sublabel
      : item.badge ? t('widget.locationFavorites.hereNow', 'Here now') : undefined,
  }));
  const headline = (
    <div className="min-w-0">
      <MetricValue>{Array.isArray(locations) && !locationsState.fatalError ? fmtInt(items.length) : '—'}</MetricValue>
      <MetricLabel>{t('dashboardWidgets.maps.locationFavorites.returnedLocations', 'Returned locations')}</MetricLabel>
    </div>
  );

  return (
    <WidgetShell
      icon={isCompact ? undefined : <MapPin className="h-3.5 w-3.5 text-theme-accent" />}
      {...shellProps}
    >
      <InstrumentPresentation
        family="list"
        compact={isCompact}
        headline={headline}
        icon={<MapPin />}
        context={snapshotError}
        instrument={locationsError || (items.length > 0
          ? <WidgetRankedList {...listProps} items={packItems} />
          : empty)}
      >
        {snapshotError}
        {locationsError || classicList}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
