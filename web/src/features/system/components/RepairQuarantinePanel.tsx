import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useRepairQuarantines,
  useRestoreQuarantine,
  type RepairQuarantine,
  type RepairQuarantineFilters,
} from '@/api/hooks/useDataRepair';
import { ListSkeleton, QueryError } from '@/components/feedback';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  GlassPanel,
  PanelTitle,
  Select,
  Text,
  Textarea,
} from '@/components/ui';
import { useRepairQuarantineColumns } from './useRepairQuarantineColumns';
import { RepairRefreshWarning } from './RepairRefreshWarning';

interface RepairQuarantinePanelProps {
  vehicleId?: number;
  canWrite: boolean;
  writeBlockReason?: string;
}
type QuarantineCursor = Pick<RepairQuarantineFilters, 'cursor_quarantined_at' | 'cursor_id'>;
export function RepairQuarantinePanel({
  vehicleId,
  canWrite,
  writeBlockReason,
}: RepairQuarantinePanelProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<RepairQuarantineFilters>({
    vehicle_id: vehicleId,
    limit: 50,
  });
  const [history, setHistory] = useState<QuarantineCursor[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<RepairQuarantine | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const query = useRepairQuarantines(filters);
  const restore = useRestoreQuarantine();
  const records = query.data?.quarantines ?? [];
  const hasData = query.data !== undefined;
  const busy = query.isFetching && !query.isLoading;
  const statusOptions = useMemo(() => [
    { value: '', label: t('dataRepair.quarantine.all', 'All records') },
    { value: 'false', label: t('dataRepair.quarantine.active', 'Awaiting restore') },
    { value: 'true', label: t('dataRepair.quarantine.restored', 'Restored') },
  ], [canWrite, t, writeBlockReason]);

  useEffect(() => {
    setFilters({ vehicle_id: vehicleId, limit: 50 });
    setHistory([]);
  }, [vehicleId]);

  const columns = useRepairQuarantineColumns(canWrite, writeBlockReason, setRestoreTarget);

  const moveNext = () => {
    const cursor = query.data?.next_cursor;
    if (!cursor) return;
    setHistory((current) => [
      ...current,
      {
        cursor_quarantined_at: filters.cursor_quarantined_at,
        cursor_id: filters.cursor_id,
      },
    ]);
    setFilters((current) => ({
      ...current,
      cursor_quarantined_at: cursor.quarantined_at,
      cursor_id: cursor.id,
    }));
  };

  const movePrevious = () => {
    setHistory((current) => {
      if (current.length === 0) return current;
      const previous = current[current.length - 1];
      setFilters((active) => ({ ...active, ...previous }));
      return current.slice(0, -1);
    });
  };

  return (
    <>
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              <PanelTitle>{t('dataRepair.quarantine.title', 'Quarantine ledger')}</PanelTitle>
              {busy ? (
                <Badge variant="info" dot aria-live="polite">
                  {t('dataRepair.cases.updating', 'Updating')}
                </Badge>
              ) : null}
            </div>
            <Text as="p" variant="bodySm" className="mt-1">
              {t(
                'dataRepair.quarantine.description',
                'Every removal retains a checksummed recovery snapshot and a complete operator trail.',
              )}
            </Text>
          </div>
          <Select
            className="sm:min-w-48"
            size="sm"
            aria-label={t('dataRepair.quarantine.filterStatus', 'Filter quarantine status')}
            value={filters.restored == null ? '' : String(filters.restored)}
            options={statusOptions}
            onChange={(event) => {
              const value = event.target.value;
              setFilters({
                vehicle_id: vehicleId,
                limit: 50,
                restored: value === '' ? undefined : value === 'true',
              });
              setHistory([]);
            }}
          />
        </div>

        {query.error && !hasData ? (
          <QueryError
            error={query.error}
            resourceName={t('dataRepair.quarantine.resourceName', 'Quarantine records')}
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading && !hasData ? (
          <ListSkeleton
            rows={6}
            label={t('dataRepair.quarantine.loading', 'Loading quarantine ledger…')}
            testId="repair-quarantine-skeleton"
          />
        ) : (
          <>
            {query.error ? (
              <RepairRefreshWarning
                message={t(
                  'dataRepair.quarantine.refreshFailed',
                  'Quarantine records could not refresh. Showing the most recently loaded ledger.',
                )}
                onRetry={() => { void query.refetch(); }}
                testId="repair-quarantine-refresh-warning"
              />
            ) : null}
            <DataTable
              tableId="data-repair:quarantine"
              columns={columns}
              data={records}
              keyExtractor={(item) => item.id}
              mobileColumns={['session', 'actions']}
              emptyMessage={t('dataRepair.quarantine.empty', 'No quarantine records match this filter.')}
              maxHeight={620}
              stickyHeader
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                onClick={movePrevious}
                disabled={history.length === 0 || query.isLoading || busy}
              >
                {t('pagination.previous', 'Previous')}
              </Button>
              <Text as="span" variant="caption" aria-live="polite">
                {t('dataRepair.quarantine.pageCount', '{{count}} records on this page', { count: records.length })}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                onClick={moveNext}
                disabled={!query.data?.has_more || query.isLoading || busy}
              >
                {t('pagination.next', 'Next')}
              </Button>
            </div>
          </>
        )}
      </GlassPanel>

      <ConfirmDialog
        open={restoreTarget != null}
        onCancel={() => { setRestoreTarget(null); setRestoreReason(''); }}
        onConfirm={() => {
          if (!restoreTarget || !restoreReason.trim()) return;
          restore.mutate(
            { quarantine_id: restoreTarget.id, reason: restoreReason.trim() },
            { onSuccess: () => { setRestoreTarget(null); setRestoreReason(''); } },
          );
        }}
        title={t('dataRepair.quarantine.confirmRestore', 'Restore quarantined session?')}
        message={t(
          'dataRepair.quarantine.confirmRestoreDescription',
          'The snapshot checksum and schema version will be verified before the session and its relationships are restored.',
        )}
        confirmLabel={t('dataRepair.cases.restoreAction', 'Restore session')}
        variant="warning"
        loading={restore.isPending}
        confirmDisabled={!restoreReason.trim()}
        details={
          <Textarea
            id="quarantine-restore-reason"
            label={t('dataRepair.cases.reasonLabel', 'Operator note')}
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t('dataRepair.quarantine.restoreReasonPlaceholder', 'Explain why this session should be restored')}
          />
        }
      />
    </>
  );
}
