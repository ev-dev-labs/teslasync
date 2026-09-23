import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, MapPin, Pencil, Ruler, Trash2, Zap } from 'lucide-react';

import {
  Badge,
  Button,
  DataTable,
  PanelTitle,
  PinButton,
  Text,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { InlineCallout, QueryError, Skeleton } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import {
  GEOFENCE_CATEGORY_LABELS,
  type GeofenceCategoryValue,
} from '../../geofenceCategories';
import { formatRatePerWh } from './helpers';
import type { Geofence, GeofenceRate } from '@/api/types';

export interface PlacesTableProps {
  places?: Geofence[];
  currentRates?: GeofenceRate[];
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelect: (place: Geofence) => void;
  onEdit?: (place: Geofence) => void;
  onDelete?: (place: Geofence) => void;
  selectedKeys?: number[];
  onSelectionChange?: (keys: number[]) => void;
  bulkActions?: (selected: Geofence[]) => ReactNode;
  includesArchived?: boolean;
  emptyMessage?: string;
}

export function PlacesTable({
  places,
  currentRates,
  isLoading,
  error,
  onRetry,
  onSelect,
  onEdit,
  onDelete,
  selectedKeys,
  onSelectionChange,
  bulkActions,
  includesArchived = false,
  emptyMessage,
}: PlacesTableProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc');

  const rateByGeofenceId = useMemo(() => {
    const rates = new Map<number, GeofenceRate>();
    for (const rate of currentRates ?? []) rates.set(rate.geofence_id, rate);
    return rates;
  }, [currentRates]);

  const rows = places ?? [];

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'category':
          return (a.category ?? '').localeCompare(b.category ?? '') * dir;
        case 'radius':
          return (a.radius - b.radius) * dir;
        case 'rate': {
          const aRate = rateByGeofenceId.get(a.id)?.rate_per_wh ?? -1;
          const bRate = rateByGeofenceId.get(b.id)?.rate_per_wh ?? -1;
          return (aRate - bRate) * dir;
        }
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir, rateByGeofenceId]);

  const columns = useMemo<Column<Geofence>[]>(
    () => [
      {
        key: 'name',
        header: t('chargingPlaces.table.name', 'Place'),
        sortable: true,
        render: (place) => (
          <div className="flex min-w-0 items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Text variant="body" className="truncate font-medium">
                  {place.name || t('chargingPlaces.unnamed', 'Unnamed place')}
                </Text>
                <PinButton itemType="geofence" itemId={String(place.id)} size="sm" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={place.origin === 'charging_discovery' ? 'info' : 'neutral'}
                  size="sm"
                >
                  {place.origin === 'charging_discovery'
                    ? t('chargingPlaces.origin.discovered', 'Auto-discovered')
                    : t('chargingPlaces.origin.manual', 'Manual')}
                </Badge>
                {place.needs_review && (
                  <Badge variant="warning" size="sm">
                    {t('chargingPlaces.detail.needsReviewBadge', 'Needs review')}
                  </Badge>
                )}
                {place.archived_at && (
                  <Badge variant="neutral" size="sm">
                    {t('chargingPlaces.archived', 'Archived')}
                  </Badge>
                )}
              </div>
              <Text size="xs" color="muted" mono className="mt-1 flex items-center gap-1">
                <Globe className="h-3 w-3" aria-hidden="true" />
                {fmtNumber(place.latitude ?? 0, 5)}, {fmtNumber(place.longitude ?? 0, 5)}
              </Text>
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        header: t('chargingPlaces.table.category', 'Category'),
        sortable: true,
        render: (place) => {
          const category = place.category as GeofenceCategoryValue | null | undefined;
          return (
            <Text size="sm" color="secondary">
              {category
                ? t(
                    GEOFENCE_CATEGORY_LABELS[category].key,
                    GEOFENCE_CATEGORY_LABELS[category].fallback,
                  )
                : t('chargingPlaces.category.unset', 'Uncategorized')}
            </Text>
          );
        },
      },
      {
        key: 'purpose',
        header: t('geofences.visits.purpose', 'Purpose'),
        sortable: false,
        render: (place) => (
          <Badge variant={place.is_charging_location ? 'success' : 'neutral'} size="sm">
            {place.is_charging_location
              ? t('geofences.visits.chargingShort', 'Charging')
              : t('geofences.visits.otherShort', 'Other place')}
          </Badge>
        ),
      },
      {
        key: 'radius',
        header: t('chargingPlaces.table.zone', 'Zone'),
        sortable: true,
        render: (place) => (
          <Text size="sm" color="secondary" className="flex items-center gap-1 tabular-nums">
            <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
            {fmtNumber(place.radius ?? 0)} {t('common.units.meterShort', 'm')}
          </Text>
        ),
      },
      {
        key: 'review',
        header: t('geofences.visits.reviewStatus', 'Review'),
        sortable: false,
        render: (place) => (
          <Badge variant={place.needs_review ? 'warning' : 'success'} size="sm">
            {place.needs_review
              ? t('chargingPlaces.detail.needsReviewBadge', 'Needs review')
              : t('geofences.visits.reviewed', 'Reviewed')}
          </Badge>
        ),
      },
      {
        key: 'rate',
        header: t('chargingPlaces.table.rate', 'Rate / kWh'),
        sortable: true,
        render: (place) => {
          const rate = rateByGeofenceId.get(place.id);
          if (!rate) {
            return (
              <Text size="sm" color="muted">
                {t('chargingPlaces.noRate', 'Not set')}
              </Text>
            );
          }
          return (
            <div>
              <Text variant="body" className="flex items-center gap-1.5 tabular-nums">
                <Zap className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                {formatRatePerWh(rate.rate_per_wh, rate.currency, locale) || '—'}
              </Text>
              <TimeStamp value={rate.effective_from} format="absolute" />
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        render: (place) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="secondary"
              icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => onSelect(place)}
            >
              {t('chargingPlaces.table.manage', 'Manage')}
            </Button>
            {onEdit && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onEdit(place)}
                aria-label={t('geofences.editGeofence', 'Edit geofence {{name}}', {
                  name: place.name,
                })}
              />
            )}
            {onDelete && !place.archived_at && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => onDelete(place)}
                aria-label={t('geofences.deleteGeofence', 'Delete geofence {{name}}', {
                  name: place.name,
                })}
              />
            )}
          </div>
        ),
      },
    ],
    [t, rateByGeofenceId, locale, onSelect, onEdit, onDelete],
  );

  if (error) {
    return (
      <QueryError
        error={error}
        onRetry={onRetry}
        resourceName={t('chargingPlaces.table.title', 'Place Directory')}
      />
    );
  }

  if (isLoading && rows.length === 0) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <InlineCallout variant="info">
        {emptyMessage ??
          (includesArchived
            ? t(
                'chargingPlaces.emptyAll',
                'No places or zones yet. Charge somewhere or add a place to start.',
              )
            : t(
                'chargingPlaces.empty',
                'No active places yet. Existing and future confirmed charging locations appear automatically.',
              ))}
      </InlineCallout>
    );
  }

  return (
    <div>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('chargingPlaces.table.title', 'Place Directory')}
        <Badge variant="neutral" size="sm">
          {rows.length}
        </Badge>
      </PanelTitle>
      <DataTable
        tableId="maps:places-zones"
        columns={columns}
        data={sortedRows}
        keyExtractor={(place) => place.id}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        selectable={onSelectionChange ? 'multi' : 'none'}
        selectedKeys={selectedKeys}
        onSelectionChange={(keys) => onSelectionChange?.(keys.map(Number))}
        bulkActions={bulkActions}
        mobileColumns={['name', 'purpose', 'actions']}
        columnVisibility
        pagination
      />
    </div>
  );
}
