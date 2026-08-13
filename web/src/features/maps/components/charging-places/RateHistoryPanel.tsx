import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { History, ListChecks, Trash2 } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge, Button, Text, DataTable, useSortToggle, ConfirmDialog, type Column } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { useConfirm } from '@/hooks/useConfirm';
import { formatRatePerWh, isRateActiveAt, isRateOpen } from './helpers';
import type { GeofenceRate } from '@/api/types';

export interface RateHistoryPanelProps {
  rates?: GeofenceRate[];
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Currently selected rate for the preview/apply panel, if any. */
  selectedRateId?: number | null;
  onSelectRate: (rate: GeofenceRate) => void;
  onDelete: (rate: GeofenceRate) => void;
  deletePending?: boolean;
}

/**
 * Every time-versioned rate for one charging place, newest first — the
 * single normalized source of truth (there is no separate "current rate"
 * column anywhere). The row whose interval contains now is current.
 * Selecting a row wires it into the preview/apply panel. Effective history
 * is immutable; only an unused future schedule can be cancelled.
 */
export function RateHistoryPanel({
  rates,
  isLoading,
  error,
  onRetry,
  selectedRateId,
  onSelectRate,
  onDelete,
  deletePending = false,
}: RateHistoryPanelProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { sortKey, sortDir, onSort } = useSortToggle('effective_from', 'desc');
  const { confirm, dialogProps } = useConfirm();

  const rows = rates ?? [];

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'effective_from': {
          const ta = Date.parse(a.effective_from);
          const tb = Date.parse(b.effective_from);
          return ((Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)) * dir;
        }
        case 'rate_per_wh':
          return (a.rate_per_wh - b.rate_per_wh) * dir;
        default:
          return 0;
      }
    });
  }, [rows, sortKey, sortDir]);

  const handleDelete = async (rate: GeofenceRate) => {
    const ok = await confirm({
      title: t('chargingPlaces.rateHistory.deleteTitle', 'Cancel this scheduled rate?'),
      message: t(
        'chargingPlaces.rateHistory.deleteMessage',
        'The previous rate will continue through this cancelled schedule. Effective rate history cannot be deleted.',
      ),
      variant: 'danger',
      confirmLabel: t('chargingPlaces.rateHistory.cancel', 'Cancel Rate'),
    });
    if (ok) onDelete(rate);
  };

  const columns = useMemo<Column<GeofenceRate>[]>(
    () => [
      {
        key: 'effective_from',
        header: t('chargingPlaces.rateHistory.effectiveFrom', 'Effective From'),
        sortable: true,
        render: (r) => <TimeStamp value={r.effective_from} format="absolute" />,
      },
      {
        key: 'rate_per_wh',
        header: t('chargingPlaces.rateHistory.rate', 'Rate / kWh'),
        sortable: true,
        render: (r) => (
          <Text variant="body" className="tabular-nums">
            {formatRatePerWh(r.rate_per_wh, r.currency, locale) || '—'}
          </Text>
        ),
      },
      {
        key: 'currency',
        header: t('chargingPlaces.rateHistory.currency', 'Currency'),
        sortable: false,
        render: (r) => (
          <Badge variant="neutral" size="sm">
            {r.currency}
          </Badge>
        ),
      },
      {
        key: 'effective_to',
        header: t('chargingPlaces.rateHistory.effectiveTo', 'Effective To'),
        sortable: false,
        render: (r) =>
          isRateActiveAt(r) ? (
            <Badge variant="success" size="sm">
              {t('chargingPlaces.rateHistory.current', 'Current')}
            </Badge>
          ) : isRateOpen(r) && Date.parse(r.effective_from) > Date.now() ? (
            <Badge variant="info" size="sm">
              {t('chargingPlaces.rateHistory.scheduled', 'Scheduled')}
            </Badge>
          ) : (
            <TimeStamp value={r.effective_to} format="absolute" />
          ),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        render: (r) => (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={selectedRateId === r.id ? 'primary' : 'secondary'}
              icon={<ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => onSelectRate(r)}
            >
              {t('chargingPlaces.rateHistory.previewSessions', 'Preview sessions')}
            </Button>
            {Date.parse(r.effective_from) > Date.now() && (
              <Button
                size="sm"
                variant="outline"
                aria-label={t('chargingPlaces.rateHistory.cancelScheduled', 'Cancel scheduled rate')}
                disabled={deletePending}
                onClick={() => void handleDelete(r)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, locale, selectedRateId, onSelectRate, deletePending],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('chargingPlaces.rateHistory.title', 'Rate History')}
      </PanelTitle>
      <Text as="p" size="sm" color="muted" className="mb-3">
        {t(
          'chargingPlaces.rateHistory.previewHelp',
          'Preview sessions shows which historical charges match a rate and what would change before anything is applied.',
        )}
      </Text>

      {error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('chargingPlaces.rateHistory.title', 'Rate History')} />
      ) : isLoading && rows.length === 0 ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <>
          {/* no-action: the adjacent rate form is the action for this empty state. */}
          <EmptyState
            message={t(
              'chargingPlaces.rateHistory.empty',
              'No rate configured yet — use the form above to start pricing sessions at this place.',
            )}
          />
        </>
      ) : (
        <DataTable
          tableId="maps:charging-place-rate-history"
          columns={columns}
          data={sortedRows}
          keyExtractor={(r) => r.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t(
            'chargingPlaces.rateHistory.empty',
            'No rate configured yet — use the form above to start pricing sessions at this place.',
          )}
        />
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </GlassPanel>
  );
}
