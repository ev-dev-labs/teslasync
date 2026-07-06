import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useLocations } from '@/api/hooks/useLocations';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import type { WidgetProps } from './types';

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
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: locations,
    isLoading: locLoading,
    error: locError,
    isFetching: locFetching,
    isStale: locStale,
    isError: locIsError,
    dataUpdatedAt: locUpdatedAt,
    refetch: locRefetch,
  } = useLocations(vehicleIdStr);

  const {
    data: snapshot,
    isLoading: snapLoading,
    error: snapError,
    isFetching: snapFetching,
    isStale: snapStale,
    isError: snapIsError,
    dataUpdatedAt: snapUpdatedAt,
    refetch: snapRefetch,
  } = useLocationSnapshotLatest(vid ?? 0);

  const isLoading = locLoading || snapLoading;
  const error = locError ?? snapError;
  const isFetching = locFetching || snapFetching;
  const isStale = locStale || snapStale;
  const isError = locIsError || snapIsError;
  const updatedAt = Math.max(locUpdatedAt ?? 0, snapUpdatedAt ?? 0);

  const isCompact = size.cols <= 1;

  const locBadge = locationBadge(snapshot, t);
  const badgeVariant: 'success' | 'warning' | 'neutral' =
    locBadge.variant === 'success' ? 'success' : locBadge.variant === 'warning' ? 'warning' : 'neutral';

  const items: RankedItem[] = useMemo(() => {
    const locs = locations ?? [];
    return locs.map((loc) => ({
      id: loc.id,
      label: loc.addressName ?? '—',
      value: loc.visitCount ?? 0,
      formattedValue: `${fmtInt(loc.visitCount ?? 0)}× · ${loc.lastVisited ? formatRelative(loc.lastVisited) : '—'}`,
      barColor: 'bg-blue-400',
    }));
  }, [locations]);

  // Both queries feed this widget: the snapshot drives the presence badge
  // (the only content in the compact layout) and the locations list drives
  // the ranked list. A manual refresh must refetch BOTH so the compact badge
  // — which is derived solely from the snapshot — actually updates.
  const handleRefresh = useCallback(() => {
    locRefetch();
    snapRefetch();
  }, [locRefetch, snapRefetch]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="flex h-full flex-col items-center justify-center gap-1 min-h-[44px]">
          <span className="text-2xl" role="img" aria-label={locBadge.label}>
            {locBadge.emoji}
          </span>
          <Badge variant={badgeVariant} size="sm">
            {locBadge.label}
          </Badge>
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.locationFavorites.title', 'Favorite Locations')}
      icon={<MapPin className="h-3.5 w-3.5 text-blue-400" />}
      {...shellProps}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg" role="img" aria-label={locBadge.label}>
          {locBadge.emoji}
        </span>
        <Badge variant={badgeVariant} size="sm">
          {locBadge.label}
        </Badge>
        {snapshot?.destination_name && (
          <span className="truncate text-xs text-[var(--text-secondary)]">
            → {snapshot.destination_name}
          </span>
        )}
      </div>

      {(locations ?? []).length > 0 ? (
        <WidgetRankedList
          items={items}
          emptyMessage={t('widget.locationFavorites.noData', 'No favorite locations')}
          emptyIcon={<MapPin className="h-5 w-5" />}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<MapPin className="h-5 w-5" />}
          message={t('widget.locationFavorites.noData', 'No favorite locations')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
