import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks } from 'lucide-react';

import { Badge, Button, Text, DataTable, type Column } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { useGeofenceChargingActivity } from '@/api/hooks/useLocations';
import type { GeofenceChargingActivity, CostSource } from '@/api/types';

export interface ChargingActivityListProps {
  geofenceId: number;
}

const PAGE_SIZE = 25;

const SOURCE_BADGE: Record<CostSource, 'success' | 'info' | 'warning' | 'neutral'> = {
  manual: 'success',
  tesla_actual: 'success',
  geofence_tariff: 'info',
  default_estimate: 'warning',
  unknown: 'neutral',
};

/**
 * Paginated, session-level charging activity feed for one place — any
 * pricing state, not just already-priced rows, so a user can see exactly
 * which sessions a rate would (or did) touch. `cost_source` surfaces the
 * provenance precedence directly (manual/Tesla-actual outrank a
 * geofence-derived estimate, which outranks the legacy default, which
 * outranks unknown/unpriced).
 */
export function ChargingActivityList({ geofenceId }: ChargingActivityListProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { formatEnergy } = useUnits();
  const [offset, setOffset] = useState(0);

  const query = useGeofenceChargingActivity(
    geofenceId,
    PAGE_SIZE,
    offset,
  );
  const { data, isLoading, refetch, isFetching } = query;
  const state = deriveDataState(query);
  const rows = data ?? [];

  useEffect(() => {
    setOffset(0);
  }, [geofenceId]);

  const columns = useMemo<Column<GeofenceChargingActivity>[]>(
    () => [
      {
        key: 'started_at',
        header: t('chargingPlaces.activity.startedAt', 'Started'),
        render: (r) => <TimeStamp value={r.started_at} format="absolute" />,
      },
      {
        key: 'ended_at',
        header: t('chargingPlaces.activity.endedAt', 'Ended'),
        render: (r) => (r.ended_at ? <TimeStamp value={r.ended_at} format="absolute" /> : <Text size="sm" color="muted">—</Text>),
      },
      {
        key: 'energy_wh',
        align: 'right',
        header: t('chargingPlaces.activity.energy', 'Energy'),
        render: (r) => <Text size="sm" className="tabular-nums">{r.energy_wh != null ? formatEnergy(r.energy_wh) : '—'}</Text>,
      },
      {
        key: 'cost_decimal',
        align: 'right',
        header: t('chargingPlaces.activity.cost', 'Cost'),
        render: (r) => (
          <Text size="sm" className="tabular-nums">
            {r.cost_decimal != null && r.cost_currency
              ? formatCurrencyValue(r.cost_decimal, r.cost_currency, locale, 2, { useGrouping: true })
              : '—'}
          </Text>
        ),
      },
      {
        key: 'cost_source',
        header: t('chargingPlaces.activity.source', 'Source'),
        render: (r) =>
          r.cost_source ? (
            <Badge variant={SOURCE_BADGE[r.cost_source] ?? 'neutral'} size="sm">
              {t(`chargingPlaces.costSource.${r.cost_source}`, r.cost_source)}
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm">
              {t('chargingPlaces.costSource.unknown', 'Unknown')}
            </Badge>
          ),
      },
    ],
    [t, locale, formatEnergy],
  );

  return (
    <LayoutCard title={t('chargingPlaces.activity.title', 'Charging activity')} actions={<ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
      <SourceContent
        state={state.refreshError ? 'retained' : 'ready'}
        label={t('chargingPlaces.activity.title', 'Charging activity')}
        errorMessage={t('chargingPlaces.activity.loadFailed', 'Charging activity could not be loaded.')}
        emptyMessage={t('chargingPlaces.activity.empty', 'No charging sessions recorded at this place yet.')}
        errorRecovery={{ onRetry: () => void refetch() }}
      >

      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => void refetch()} resourceName={t('chargingPlaces.activity.title', 'Charging activity')} />
      ) : isLoading && !state.hasData ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 && offset === 0 ? (
        <>
          {/* no-action: charging sessions appear here automatically after the vehicle charges at this place. */}
          <EmptyState message={state.hasData
            ? t('chargingPlaces.activity.empty', 'No charging sessions recorded at this place yet.')
            : t('chargingPlaces.activity.unavailable', 'Charging activity is unavailable.')} />
        </>
      ) : (
        <>
          <DataTable
            tableId="maps:charging-place-activity"
            columns={columns}
            mobileColumns={['started_at', 'cost_decimal', 'cost_source']}
            data={rows}
            keyExtractor={(r) => r.session_id}
            emptyMessage={t('chargingPlaces.activity.empty', 'No charging sessions recorded at this place yet.')}
          />
          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Text size="sm" color="muted">
              {t('chargingPlaces.activity.pageInfo', 'Showing {{from}}–{{to}}', {
                from: rows.length > 0 ? offset + 1 : 0,
                to: offset + rows.length,
              })}
            </Text>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                wrapLabel
                size="sm"
                variant="secondary"
                disabled={offset === 0 || isFetching}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                {t('common.previous', 'Previous')}
              </Button>
              <Button
                wrapLabel
                size="sm"
                variant="secondary"
                disabled={rows.length < PAGE_SIZE || isFetching}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                {t('common.next', 'Next')}
              </Button>
            </div>
          </div>
        </>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
