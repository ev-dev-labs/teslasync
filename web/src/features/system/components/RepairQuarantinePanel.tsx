import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useRepairQuarantines,
  useRestoreQuarantine,
  type RepairQuarantine,
  type RepairQuarantineFilters,
} from '@/api/hooks/useDataRepair';
import { ListSkeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
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
  useTableExpansion,
} from '@/components/ui';
import { useRepairQuarantineColumns } from './useRepairQuarantineColumns';

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
  const { expandedKeys, setExpandedKeys } = useTableExpansion<number>();
  const { t } = useTranslation();
  const [filters, setFilters] = useState<RepairQuarantineFilters>({
    vehicle_id: vehicleId,
    limit: 50,
  });
  const [history, setHistory] = useState<QuarantineCursor[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<{
    quarantine: RepairQuarantine;
    vehicleId: number | undefined;
    revision: number;
  } | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const scope = useRef({ vehicleId, revision: 0 });
  if (scope.current.vehicleId !== vehicleId) {
    scope.current = { vehicleId, revision: scope.current.revision + 1 };
  }
  const query = useRepairQuarantines(filters);
  const responseIsCurrent = filters.vehicle_id === vehicleId && query.canWriteCurrentScope;
  const state = useDataState(
    query,
    { provenance: 'historical' },
  );
  const restore = useRestoreQuarantine();
  const inFlight = useRef(false);
  const writesAllowed = canWrite && responseIsCurrent;
  const current = useRef({ canWrite: writesAllowed, restoreTarget, restoreReason, pending: restore.isPending });
  current.current = { canWrite: writesAllowed, restoreTarget, restoreReason, pending: restore.isPending };
  const targetIsCurrent = restoreTarget?.vehicleId === vehicleId
    && restoreTarget?.revision === scope.current.revision;
  const restoreDisabled = !writesAllowed || !targetIsCurrent || restore.isPending;
  const records = state.data?.quarantines ?? [];
  const hasData = state.hasData;
  const busy = state.isRefreshing;
  const statusOptions = useMemo(() => [
    { value: '', label: t('dataRepair.quarantine.all', 'All records') },
    { value: 'false', label: t('dataRepair.quarantine.active', 'Awaiting restore') },
    { value: 'true', label: t('dataRepair.quarantine.restored', 'Restored') },
  ], [t]);

  useEffect(() => {
    setFilters({ vehicle_id: vehicleId, limit: 50 });
    setHistory([]);
    setRestoreTarget(null);
    setRestoreReason('');
  }, [vehicleId]);

  const columns = useRepairQuarantineColumns(writesAllowed, writeBlockReason, (quarantine) => {
    if (!current.current.canWrite || current.current.pending || inFlight.current
      || filters.vehicle_id !== scope.current.vehicleId
      || (scope.current.vehicleId != null && quarantine.vehicle_id !== scope.current.vehicleId)
      || quarantine.restored_at) return;
    setRestoreTarget({ quarantine, ...scope.current });
    setRestoreReason('');
  });

  const moveNext = () => {
    if (!responseIsCurrent || query.isFetching) return;
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
              setRestoreTarget(null);
              setRestoreReason('');
            }}
          />
        </div>

        {query.isPreviousScope ? (
          <Text as="p" variant="bodySm" role="status" className="mb-3 break-words">
            {t('operations.sourceStatus.stale', 'Retained source')}: {query.sourceScope}
          </Text>
        ) : null}
        {state.fatalError ? (
          <QueryError
            error={state.fatalError}
            resourceName={t('dataRepair.quarantine.resourceName', 'Quarantine records')}
            onRetry={() => query.refetch()}
          />
        ) : !hasData ? (
          <div role="status">
            <Text as="p" variant="bodySm" className="mb-3">
              {state.isRefreshBlocked
                ? t('shareCard.states.paused', 'The initial query is paused while the network is unavailable; no empty response is inferred.')
                : t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
            </Text>
            {query.isFetching || query.isLoading ? (
              <ListSkeleton
                rows={6}
                label={t('dataRepair.quarantine.loading', 'Loading quarantine ledger…')}
                testId="repair-quarantine-skeleton"
              />
            ) : null}
          </div>
        ) : (
          <>
            <StaleRefreshWarning
              state={state}
              label={t('dataRepair.quarantine.resourceName', 'Quarantine records')}
              message={state.refreshError ? t(
                'dataRepair.quarantine.refreshFailed',
                'Quarantine records could not refresh. Showing the most recently loaded ledger.',
              ) : undefined}
            />
            <DataTable
              tableId="data-repair:quarantine"
              enableValueFilters={false}
              columns={columns}
              data={records}
              keyExtractor={(item) => item.id}
              mobileColumns={['session', 'actions']}
              expandable
              expandedKeys={expandedKeys}
              onExpandedChange={setExpandedKeys}
              renderExpanded={(item) => (
                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {columns.filter((column) => !['session', 'actions'].includes(column.key)).map((column) => (
                    <div key={column.key} className="min-w-0 break-words">
                      <Text as="dt" variant="caption">{column.header}</Text>
                      <dd className="mt-1">{column.render(item)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              emptyMessage={query.isPreviousScope
                ? t('operations.sourceStatus.stale', 'Retained source')
                : t('dataRepair.quarantine.empty', 'No quarantine records match this filter.')}
              maxHeight={620}
              stickyHeader
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                onClick={movePrevious}
                disabled={history.length === 0 || query.isLoading || busy || !responseIsCurrent}
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
                disabled={!query.data?.has_more || query.isLoading || busy || !responseIsCurrent}
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
          const active = current.current;
          const target = active.restoreTarget;
          if (!active.canWrite || active.pending || inFlight.current || !target || target !== restoreTarget
            || target.vehicleId !== scope.current.vehicleId
            || target.revision !== scope.current.revision || !active.restoreReason.trim()) return;
          inFlight.current = true;
          restore.mutate(
            { quarantine_id: target.quarantine.id, reason: active.restoreReason.trim() },
            {
              onSuccess: () => {
                if (current.current.restoreTarget !== target
                  || target.revision !== scope.current.revision) return;
                setRestoreTarget(null);
                setRestoreReason('');
              },
              onSettled: () => { inFlight.current = false; },
            },
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
        confirmDisabled={restoreDisabled || !restoreReason.trim()}
        details={
          <>
            {!canWrite && writeBlockReason ? (
              <Text as="p" variant="bodySm" role="status" className="mb-3 break-words">
                {writeBlockReason}
              </Text>
            ) : null}
            <Textarea
              id="quarantine-restore-reason"
              label={t('dataRepair.cases.reasonLabel', 'Operator note')}
              value={restoreReason}
              onChange={(event) => {
                if (!current.current.canWrite || current.current.pending || inFlight.current
                  || current.current.restoreTarget?.revision !== scope.current.revision) return;
                setRestoreReason(event.target.value);
              }}
              disabled={restoreDisabled}
              rows={3}
              maxLength={1000}
              placeholder={t('dataRepair.quarantine.restoreReasonPlaceholder', 'Explain why this session should be restored')}
            />
          </>
        }
      />
    </>
  );
}
