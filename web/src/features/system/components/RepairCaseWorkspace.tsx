import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useBulkTransitionRepairCases,
  useRepairCases,
  useRunRepairScan,
  type RepairCaseFilters,
} from '@/api/hooks/useDataRepair';
import { useRepairCaseStats } from '@/api/hooks/useRepairCaseStats';
import { Tabs } from '@/components/ui';
import { RepairBulkDismissDialog } from './RepairBulkDismissDialog';
import { RepairCaseDrawer } from './RepairCaseDrawer';
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
  const scan = useRunRepairScan();
  const bulk = useBulkTransitionRepairCases();
  const cases = casesQuery.data?.cases ?? [];

  useEffect(() => {
    setFilters({ vehicle_id: vehicleId, status: 'open', limit: 50 });
    setHistory([]);
    setSelectedCaseIds([]);
    setActiveCaseId(null);
  }, [vehicleId]);

  const updateFilters = (next: RepairCaseFilters) => {
    setFilters(next);
    setHistory([]);
    setSelectedCaseIds([]);
  };

  const moveNext = () => {
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
    if (ids.length === 0) return;
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
    if (dismissIds.length === 0 || !dismissReason.trim()) return;
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
      <RepairCaseWorkspaceHeader
        statistics={statsQuery.data}
        statisticsLoading={statsQuery.isLoading}
        statisticsBusy={statsQuery.isFetching && !statsQuery.isLoading}
        statisticsError={statsQuery.error}
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
          <RepairCaseQueue
            cases={cases}
            filters={filters}
            selectedCaseIds={selectedCaseIds}
            loading={casesQuery.isLoading}
            hasData={casesQuery.data !== undefined}
            busy={casesQuery.isFetching && !casesQuery.isLoading}
            error={casesQuery.error}
            hasMore={casesQuery.data?.has_more ?? false}
            hasPrevious={history.length > 0}
            onFiltersChange={updateFilters}
            onSelectionChange={setSelectedCaseIds}
            onOpenCase={setActiveCaseId}
            onPrevious={movePrevious}
            onNext={moveNext}
            onRetry={() => casesQuery.refetch()}
            onBeginReview={runBulkReview}
            onDismiss={setDismissIds}
            bulkPending={bulk.isPending || !canWrite}
          />
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
        canWrite={canWrite}
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
