import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Zap } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge, Button, Text, DataTable, useSortToggle, type Column } from '@/components/ui';
import { InlineCallout, Skeleton, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { formatRatePerWh } from './helpers';
import type { Geofence, GeofenceRate } from '@/api/types';

export interface PlacesTableProps {
  places?: Geofence[];
  /** Bulk current-rate lookup (one row per geofence with an active rate). */
  currentRates?: GeofenceRate[];
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelect: (place: Geofence) => void;
  /** True while the "Show archived" toggle is on — only affects the empty-state copy. */
  includesArchived?: boolean;
}

/**
 * The Charging Places list — every geofence the user can configure
 * pricing for, with its currently-active rate (if any) resolved from the
 * bulk `/geofences/rates/current` lookup rather than a per-row fetch.
 */
export function PlacesTable({
  places,
  currentRates,
  isLoading,
  error,
  onRetry,
  onSelect,
  includesArchived = false,
}: PlacesTableProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc');

  const rateByGeofenceId = useMemo(() => {
    const m = new Map<number, GeofenceRate>();
    for (const r of currentRates ?? []) m.set(r.geofence_id, r);
    return m;
  }, [currentRates]);

  const rows = places ?? [];

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'origin':
          return a.origin.localeCompare(b.origin) * dir;
        case 'rate': {
          const ra = rateByGeofenceId.get(a.id)?.rate_per_wh ?? -1;
          const rb = rateByGeofenceId.get(b.id)?.rate_per_wh ?? -1;
          return (ra - rb) * dir;
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
        render: (g) => (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <div className="flex min-w-0 flex-col">
              <Text variant="body" className="truncate font-medium">
                {g.name || t('chargingPlaces.unnamed', 'Unnamed place')}
              </Text>
              {g.archived_at && (
                <Badge variant="neutral" size="sm" className="mt-0.5 w-fit">
                  {t('chargingPlaces.archived', 'Archived')}
                </Badge>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'origin',
        header: t('chargingPlaces.table.origin', 'Origin'),
        sortable: true,
        render: (g) => (
          <Badge variant={g.origin === 'charging_discovery' ? 'info' : 'neutral'} size="sm">
            {g.origin === 'charging_discovery'
              ? t('chargingPlaces.origin.discovered', 'Auto-discovered')
              : t('chargingPlaces.origin.manual', 'Manual')}
          </Badge>
        ),
      },
      {
        key: 'category',
        header: t('chargingPlaces.table.category', 'Category'),
        sortable: false,
        render: (g) => (
          <Text size="sm" color="secondary">
            {g.category
              ? t(`chargingPlaces.category.${g.category}`, g.category)
              : t('chargingPlaces.category.unset', 'Uncategorized')}
          </Text>
        ),
      },
      {
        key: 'rate',
        header: t('chargingPlaces.table.rate', 'Rate / kWh'),
        sortable: true,
        render: (g) => {
          const rate = rateByGeofenceId.get(g.id);
          if (!rate) {
            return (
              <Text size="sm" color="muted">
                {t('chargingPlaces.noRate', 'Not set')}
              </Text>
            );
          }
          return (
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              <Text variant="body" className="tabular-nums">
                {formatRatePerWh(rate.rate_per_wh, rate.currency, locale) || '—'}
              </Text>
            </div>
          );
        },
      },
      {
        key: 'effective_from',
        header: t('chargingPlaces.table.effectiveSince', 'Effective since'),
        sortable: false,
        render: (g) => {
          const rate = rateByGeofenceId.get(g.id);
          return rate ? (
            <TimeStamp value={rate.effective_from} format="absolute" />
          ) : (
            <Text size="sm" color="muted">—</Text>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        render: (g) => (
          <Button size="sm" variant="secondary" onClick={() => onSelect(g)}>
            {t('chargingPlaces.table.manage', 'Manage')}
          </Button>
        ),
      },
    ],
    [t, rateByGeofenceId, locale, onSelect],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('chargingPlaces.table.title', 'Place Directory')}
        {rows.length > 0 && (
          <Badge variant="neutral" size="sm">
            {rows.length}
          </Badge>
        )}
      </PanelTitle>

      {error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('chargingPlaces.table.title', 'Place Directory')} />
      ) : isLoading && rows.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <InlineCallout variant="info">
          {includesArchived
            ? t(
                'chargingPlaces.emptyAll',
                'No charging places yet. Charge somewhere or create a geofence above to start tracking costs.',
              )
            : t(
                'chargingPlaces.empty',
                'No active charging places yet. Existing and future confirmed charging locations appear automatically.',
              )}
        </InlineCallout>
      ) : (
        <DataTable
          tableId="maps:charging-places"
          columns={columns}
          data={sortedRows}
          keyExtractor={(g) => g.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('chargingPlaces.empty', 'No active charging places yet.')}
          pagination
        />
      )}
    </GlassPanel>
  );
}
