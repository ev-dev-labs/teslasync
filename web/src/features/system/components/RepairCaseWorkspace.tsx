import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useBulkTransitionRepairCases,
  useRepairCases,
  useRunRepairScan,
  type RepairCaseFilters,
} from '@/api/hooks/useDataRepair';
import { useRepairCaseStats } from '@/api/hooks/useRepairCaseStats';
import { GlassPanel, PanelTitle, Tabs, Text } from '@/components/ui';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { RepairBulkDismissDialog } from './RepairBulkDismissDialog';
import { RepairCaseDrawer } from './RepairCaseDrawer';
import { RepairCaseFiltersBar } from './RepairCaseFiltersBar';
import { RepairCaseQueue } from './RepairCaseQueue';
import { RepairCaseWorkspaceHeader } from './RepairCaseWorkspaceHeader';
import { RepairQuarantinePanel } from './RepairQuarantinePanel';

interface RepairCaseWorkspaceProps {
  vehicleId?: number;
  canWrite: boolean;
  writeBlockReason?: string;
  diagnostics?: ReactNode;
}

type CaseCursor = Pick<RepairCaseFilters, 'cursor_last_seen_at' | 'cursor_id'>;
type WorkspaceTab = 'cases' | 'quarantine' | 'diagnostics';

export function RepairCaseWorkspace({
  vehicleId,
  canWrite,
  writeBlockReason,
  diagnostics,
}: RepairCaseWorkspaceProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('cases');
  const [filters, setFilters] = useState<RepairCaseFilters>({
    vehicle_id: vehicleId,
    status: 'open',
    limit: 50,
  });
  const [history, setHistory] = useState<CaseCursor[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<number[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null);
  const [dismissIds, setDismissIds] = useState<number[]>([]);
  const [dismissReason, setDismissReason] = useState('');
  const casesQuery = useRepairCases(filters);
  const statsQuery = useRepairCaseStats(vehicleId);
  const casesState = useDataState(casesQuery);
  const statisticsState = useDataState(statsQuery);
  const scan = useRunRepairScan();
  const bulk = useBulkTransitionRepairCases();
  const cases = casesQuery.data?.cases ?? [];
  const scopeIsCurrent = filters.vehicle_id === vehicleId && casesQuery.canWriteCurrentScope;
  const writesAllowed = canWrite && scopeIsCurrent;
  const currentScope = useRef({ writesAllowed, scope: casesQuery.currentScope });
  currentScope.current = { writesAllowed, scope: casesQuery.currentScope };
  const canSubmit = () => currentScope.current.writesAllowed
    && currentScope.current.scope === casesQuery.currentScope;

  useEffect(() => {
    setFilters({ vehicle_id: vehicleId, status: 'open', limit: 50 });
    setHistory([]);
    setSelectedCaseIds([]);
    setActiveCaseId(null);
    setDismissIds([]);
    setDismissReason('');
  }, [vehicleId]);

  const updateFilters = (next: RepairCaseFilters) => {
    setFilters(next);
    setHistory([]);
    setSelectedCaseIds([]);
    setActiveCaseId(null);
    setDismissIds([]);
    setDismissReason('');
  };

  const moveNext = () => {
    if (!scopeIsCurrent || casesQuery.isFetching) return;
    const cursor = casesQuery.data?.next_cursor;
    if (!cursor) return;
    setHistory((current) => [
      ...current,
      { cursor_last_seen_at: filters.cursor_last_seen_at, cursor_id: filters.cursor_id },
    ]);
    setFilters((current) => ({
      ...current,
      cursor_last_seen_at: cursor.last_seen_at,
      cursor_id: cursor.id,
    }));
    setSelectedCaseIds([]);
  };

  const movePrevious = () => {
    setHistory((current) => {
      if (current.length === 0) return current;
      const previous = current[current.length - 1];
      setFilters((active) => ({ ...active, ...previous }));
      return current.slice(0, -1);
    });
    setSelectedCaseIds([]);
  };

  const runBulkReview = (ids: number[]) => {
    if (!canSubmit() || ids.length === 0) return;
    bulk.mutate(
      { case_ids: ids, status: 'in_review' },
      {
        onSuccess: (result) => {
          if (result.skipped === 0) setSelectedCaseIds([]);
        },
      },
    );
  };

  const confirmBulkDismiss = () => {
    if (!canSubmit() || dismissIds.length === 0 || !dismissReason.trim()) return;
    bulk.mutate(
      { case_ids: dismissIds, status: 'dismissed', resolution_note: dismissReason.trim() },
      {
        onSuccess: (result) => {
          setDismissIds([]);
          setDismissReason('');
          if (result.skipped === 0) setSelectedCaseIds([]);
        },
      },
    );
  };

  const selectTab = (key: string) => {
    if (key === 'cases' || key === 'quarantine' || key === 'diagnostics') {
      setActiveTab(key);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="repair-case-workspace-title">
      {statsQuery.isPreviousScope ? (
        <Text as="p" variant="bodySm" role="status" className="break-words">
          {t('operations.sourceStatus.stale', 'Retained source')}: {statsQuery.sourceScope}
        </Text>
      ) : null}
      <RepairCaseWorkspaceHeader
        statistics={statsQuery.data}
        statisticsLoading={statsQuery.isLoading && !statisticsState.hasData}
        statisticsBusy={statsQuery.isFetching && !statsQuery.isLoading}
        statisticsError={statisticsState.fatalError ?? statisticsState.refreshError}
        statisticsState={statisticsState}
        scanPending={scan.isPending}
        canWrite={canWrite}
        writeBlockReason={writeBlockReason}
        onScan={() => scan.mutate({ vehicle_id: vehicleId })}
        onRetryStatistics={() => { void statsQuery.refetch(); }}
      />

      <Tabs
        idBase="repair-workspace-tabs"
        ariaLabel={t('dataRepair.cases.workspaceTabs', 'Repair workspace views')}
        tabs={[
          { key: 'cases', label: t('dataRepair.cases.tabCases', 'Case queue') },
          { key: 'quarantine', label: t('dataRepair.cases.tabQuarantine', 'Quarantine ledger') },
          ...(diagnostics
            ? [{ key: 'diagnostics', label: t('dataRepair.cases.tabDiagnostics', 'Diagnostics') }]
            : []),
        ]}
        activeTab={activeTab}
        onChange={selectTab}
      />

      <div
        id={`repair-workspace-tabs-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`repair-workspace-tabs-tab-${activeTab}`}
      >
        {activeTab === 'cases' ? (
          <>
            {casesQuery.isPreviousScope ? (
              <Text as="p" variant="bodySm" role="status" className="break-words">
                {t('operations.sourceStatus.stale', 'Retained source')}: {casesQuery.sourceScope}
              </Text>
            ) : null}
            <StaleRefreshWarning
              state={casesState}
              label={t('dataRepair.cases.resourceName', 'Repair cases')}
              message={casesState.refreshError ? t(
                'dataRepair.cases.refreshFailed',
                'Repair cases could not refresh. Showing the most recently loaded queue.',
              ) : undefined}
            />
            {(!casesState.hasData || (casesQuery.isPreviousScope && cases.length === 0))
              && !casesState.fatalError && !casesQuery.isLoading ? (
              <GlassPanel className="min-w-0 p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <PanelTitle>{t('dataRepair.cases.queueTitle', 'Repair case queue')}</PanelTitle>
                    <Text as="p" variant="bodySm" className="mt-1">
                      {t('dataRepair.cases.queueDescription', 'Durable findings stay visible until an operator reviews and resolves them.')}
                    </Text>
                  </div>
                  <RepairCaseFiltersBar filters={filters} onChange={updateFilters} />
                </div>
                <Text as="p" variant="bodySm" role="status" className="mt-3">
                  {casesState.isRefreshBlocked
                    ? t('shareCard.states.paused', 'The initial query is paused while the network is unavailable; no empty response is inferred.')
                    : t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
                </Text>
              </GlassPanel>
            ) : (
              <RepairCaseQueue
                cases={cases}
                filters={filters}
                selectedCaseIds={selectedCaseIds}
                loading={casesQuery.isLoading && !casesState.hasData}
                hasData={casesState.hasData}
                busy={casesState.isRefreshing || !scopeIsCurrent}
                error={casesState.fatalError}
                hasMore={casesQuery.data?.has_more ?? false}
                hasPrevious={history.length > 0}
                onFiltersChange={updateFilters}
                onSelectionChange={setSelectedCaseIds}
                onOpenCase={(id) => { if (scopeIsCurrent) setActiveCaseId(id); }}
                onPrevious={movePrevious}
                onNext={moveNext}
                onRetry={() => casesQuery.refetch()}
                onBeginReview={runBulkReview}
                onDismiss={(ids) => { if (canSubmit()) setDismissIds(ids); }}
                bulkPending={bulk.isPending || !writesAllowed}
              />
            )}
          </>
        ) : activeTab === 'quarantine' ? (
          <RepairQuarantinePanel
            vehicleId={vehicleId}
            canWrite={canWrite}
            writeBlockReason={writeBlockReason}
          />
        ) : (
          diagnostics
        )}
      </div>

      <RepairCaseDrawer
        caseId={activeCaseId}
        onClose={() => setActiveCaseId(null)}
        canWrite={writesAllowed}
        writeBlockReason={writeBlockReason}
      />

      <RepairBulkDismissDialog
        caseCount={dismissIds.length}
        reason={dismissReason}
        loading={bulk.isPending}
        onReasonChange={setDismissReason}
        onCancel={() => { setDismissIds([]); setDismissReason(''); }}
        onConfirm={confirmBulkDismiss}
      />
    </section>
  );
}
