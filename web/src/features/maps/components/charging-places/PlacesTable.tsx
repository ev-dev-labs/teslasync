import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, MapPin, Pencil, Ruler, Trash2, Zap } from 'lucide-react';

import {
  Badge,
  Button,
  DataTable,
  PinButton,
  Text,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { InlineCallout, QueryError, Skeleton } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { TimeStamp } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';

import {
  GEOFENCE_CATEGORY_LABELS,
  type GeofenceCategoryValue,
} from '../../geofenceCategories';
import { formatRatePerWh } from './helpers';
import type { Geofence, GeofenceRate } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface PlacesTableProps {
  places?: Geofence[];
  filterData?: Geofence[];
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
  /** Undefined rates are unresolved, not an authoritative empty rate list. */
  ratesLoading?: boolean;
}

export function PlacesTable({
  places,
  filterData,
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
  ratesLoading = false,
}: PlacesTableProps) {
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc');

  const rateByGeofenceId = useMemo(() => {
    const rates = new Map<number, GeofenceRate>();
    for (const rate of currentRates ?? []) rates.set(rate.geofence_id, rate);
    return rates;
  }, [currentRates]);

  const rows = places ?? [];
  const state = deriveDataState({ data: places, isLoading, error });

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
        filterValue: (place) => place.id,
        filterValueLabel: (_value, place) => place.name || t('chargingPlaces.unnamed', 'Unnamed place'),
        sortable: true,
        render: (place) => (
          <div className="flex min-w-0 items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Text variant="body" className="break-words font-medium">
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
                {fmtScientificNumber(place.latitude, 5)}, {fmtScientificNumber(place.longitude, 5)}
              </Text>
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        header: t('chargingPlaces.table.category', 'Category'),
        filterValue: (place) => place.category ?? null,
        filterValueLabel: (_value, place) => {
          const category = place.category as GeofenceCategoryValue | null | undefined;
          return category
            ? t(GEOFENCE_CATEGORY_LABELS[category].key, GEOFENCE_CATEGORY_LABELS[category].fallback)
            : t('chargingPlaces.category.unset', 'Uncategorized');
        },
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
        filterValue: (place) => place.is_charging_location ?? null,
        filterValueLabel: (_value, place) => place.is_charging_location == null ? '—' : place.is_charging_location
          ? t('geofences.visits.chargingShort', 'Charging')
          : t('geofences.visits.otherShort', 'Other place'),
        sortable: false,
        render: (place) => (
          <Badge variant={place.is_charging_location ? 'success' : 'neutral'} size="sm">
            {place.is_charging_location == null ? '—' : place.is_charging_location
              ? t('geofences.visits.chargingShort', 'Charging')
              : t('geofences.visits.otherShort', 'Other place')}
          </Badge>
        ),
      },
      {
        key: 'radius',
        groupStart: true,
        header: t('chargingPlaces.table.zone', 'Zone'),
        align: 'right',
        filterValue: (place) => place.radius ?? null,
        filterValueLabel: (_value, place) => place.radius == null ? '—' : `${fmtNumber(place.radius)} ${t('common.units.meterShort', 'm')}`,
        sortable: true,
        render: (place) => (
          <Text size="sm" color="secondary" className="flex items-center justify-end gap-1 tabular-nums">
            <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
            {place.radius == null ? '—' : `${fmtNumber(place.radius)} ${t('common.units.meterShort', 'm')}`}
          </Text>
        ),
      },
      {
        key: 'review',
        header: t('geofences.visits.reviewStatus', 'Review'),
        filterValue: (place) => place.needs_review ?? null,
        filterValueLabel: (_value, place) => place.needs_review == null ? '—' : place.needs_review
          ? t('chargingPlaces.detail.needsReviewBadge', 'Needs review')
          : t('geofences.visits.reviewed', 'Reviewed'),
        sortable: false,
        render: (place) => (
          <Badge variant={place.needs_review == null ? 'neutral' : place.needs_review ? 'warning' : 'success'} size="sm">
            {place.needs_review == null ? '—' : place.needs_review
              ? t('chargingPlaces.detail.needsReviewBadge', 'Needs review')
              : t('geofences.visits.reviewed', 'Reviewed')}
          </Badge>
        ),
      },
      {
        key: 'rate',
        groupStart: true,
        header: t('chargingPlaces.table.rate', 'Rate / kWh'),
        align: 'right',
        filterValue: (place) => {
          const rate = rateByGeofenceId.get(place.id);
          return rate ? `${rate.currency}:${rate.rate_per_wh}` : null;
        },
        filterValueLabel: (_value, place) => {
          const rate = rateByGeofenceId.get(place.id);
          return rate ? formatRatePerWh(rate.rate_per_wh, rate.currency, locale) || '—'
            : currentRates === undefined
              ? ratesLoading ? t('chargingPlaces.rateLoading', 'Loading rate…') : t('chargingPlaces.rateUnavailable', 'Rate unavailable')
              : t('chargingPlaces.noRate', 'Not set');
        },
        sortable: true,
        render: (place) => {
          const rate = rateByGeofenceId.get(place.id);
          if (!rate) {
            return (
              <Text size="sm" color="muted">
                {currentRates === undefined
                  ? ratesLoading ? t('chargingPlaces.rateLoading', 'Loading rate…') : t('chargingPlaces.rateUnavailable', 'Rate unavailable')
                  : t('chargingPlaces.noRate', 'Not set')}
              </Text>
            );
          }
          return (
            <div>
              <Text variant="body" className="flex items-center justify-end gap-1.5 tabular-nums">
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
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            <Button
              wrapLabel
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
    [t, rateByGeofenceId, currentRates, ratesLoading, locale, onSelect, onEdit, onDelete, fmtNumber, fmtScientificNumber],
  );

  return (
    <LayoutCard title={t('chargingPlaces.table.title', 'Place directory')} actions={
      <>
        <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <Badge variant="neutral" size="sm">
          {state.hasData ? rows.length : '—'}
        </Badge>
      </>
    }>
      <SourceContent
        state={state.refreshError ? 'retained' : 'ready'}
        label={t('chargingPlaces.table.title', 'Place directory')}
        errorMessage={t('chargingPlaces.workspace.placesLoadFailed', 'The place directory could not be loaded.')}
        emptyMessage={t('chargingPlaces.workspace.noPlaces', 'No places are available.')}
        errorRecovery={{ onRetry }}
      >
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={onRetry} resourceName={t('chargingPlaces.table.title', 'Place directory')} />
      ) : isLoading && !state.hasData ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <InlineCallout variant="info">
          {!state.hasData
            ? t('chargingPlaces.directoryUnavailable', 'Place directory is unavailable.')
            : emptyMessage ?? (includesArchived
              ? t('chargingPlaces.emptyAll', 'No places or zones yet. Charge somewhere or add a place to start.')
              : t('chargingPlaces.empty', 'No active places yet. Existing and future confirmed charging locations appear automatically.'))}
        </InlineCallout>
      ) : (
      <DataTable
        tableId="maps:places-zones"
        enableValueFilters
        filterData={filterData ?? rows}
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
      )}
      </SourceContent>
    </LayoutCard>
  );
}
