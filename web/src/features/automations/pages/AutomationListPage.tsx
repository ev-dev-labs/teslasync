import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button, Input, Select, type SelectOption } from '@/components/ui';
import { BulkActionToolbar, MetricCard } from '@/components/data-display';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { OperationalWriteNotice, Skeleton } from '@/components/feedback';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useAutomations, useBulkAutomationsUpdate } from '@/api/hooks/useAutomations';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { Automation } from '@/api/types';
import { Icons } from '@/lib/icons';
import { fmtInt } from '@/lib/numberFormat';

import { AutomationListTable } from './AutomationListTable';
import { AutomationStatusPanel } from './AutomationStatusPanel';

type RowKey = string | number;
type StatusFilter = 'all' | 'active' | 'disabled' | 'auto-disabled';

/**
 * AutomationListPage — the streamlined "manage many at once" view.
 *
 * A full-width, mobile-first bulk-management surface: a KPI band summarizes the
 * fleet of automations, a header toolbar filters by status/search, and a bento
 * pairs the selectable table (hero) with a status-breakdown context panel. The
 * card-based AutomationsListPage remains the rich single-item browse view; this
 * page is the bulk-control alternative for users with dozens of automations.
 */
export default function AutomationListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('automationList.title', 'Automations (list)'));

  const automationsQuery = useAutomations();
  const { data: rowsRaw, isLoading, error, refetch } = automationsQuery;
  const automations: Automation[] = useMemo(() => rowsRaw ?? [], [rowsRaw]);

  const { data: vehiclesRaw } = useVehicles();
  const vehicleLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of vehiclesRaw ?? []) map.set(v.id, v.display_name || v.vin);
    return map;
  }, [vehiclesRaw]);

  const bulkUpdate = useBulkAutomationsUpdate();
  const operationalMode = useOperationalMode();

  // ── Filters ────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: t('automationList.filter.all', 'All statuses') },
      { value: 'active', label: t('automationList.filter.active', 'Active') },
      { value: 'disabled', label: t('automationList.filter.disabled', 'Disabled') },
      { value: 'auto-disabled', label: t('automationList.filter.autoDisabled', 'Auto-disabled') },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    let result = automations;
    if (statusFilter !== 'all') {
      result = result.filter((a) => {
        if (statusFilter === 'active') return a.enabled && !a.auto_disabled;
        if (statusFilter === 'disabled') return !a.enabled && !a.auto_disabled;
        return a.auto_disabled;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [automations, statusFilter, search]);

  // ── Summary stats (from the full, unfiltered set) ────────────────────────────
  const stats = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let autoDisabled = 0;
    let totalRuns = 0;
    let totalFailures = 0;
    for (const a of automations) {
      if (a.auto_disabled) autoDisabled += 1;
      else if (a.enabled) active += 1;
      else disabled += 1;
      totalRuns += a.execution_count ?? 0;
      totalFailures += a.failure_count ?? 0;
    }
    return {
      total: automations.length,
      active,
      disabled,
      autoDisabled,
      totalRuns,
      totalFailures,
    };
  }, [automations]);

  // ── Selection (native DataTable multi-select, pruned to visible rows) ────────
  const [selectedKeys, setSelectedKeys] = useState<RowKey[]>([]);
  const visibleIdSet = useMemo(() => new Set(filtered.map((a) => a.id)), [filtered]);
  const effectiveSelected = useMemo(
    () => selectedKeys.filter((k) => visibleIdSet.has(Number(k))),
    [selectedKeys, visibleIdSet],
  );
  const clearSelection = useCallback(() => setSelectedKeys([]), []);

  const runBulk = useCallback(
    async (ids: RowKey[], op: 'enable' | 'disable' | 'delete') => {
      try {
        await bulkUpdate.mutateAsync({ ids: ids.map((i) => Number(i)), op });
        // Only drop the selection once the server confirms the op — a failed
        // mutation keeps the rows selected so the user can retry.
        setSelectedKeys([]);
      } catch {
        // The bulk mutation hook already surfaces a toast on failure. Swallow
        // the rejection here so the toolbar's fire-and-forget onClick never
        // leaks an unhandled promise rejection.
      }
    },
    [bulkUpdate],
  );

  // ── Header toolbar (status filter + search + create) ─────────────────────────
  const actions = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
      <Select
        options={statusOptions}
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        aria-label={t('automationList.filter.statusAria', 'Filter automations by status')}
        className="w-40"
      />
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('automationList.search', 'Search automations…')}
        aria-label={t('automationList.searchAria', 'Search automations')}
        icon={<Icons.search className="h-4 w-4" aria-hidden="true" />}
        className="w-full sm:w-56"
      />
      <Button
        variant="primary"
        icon={<Icons.add className="h-4 w-4" aria-hidden="true" />}
        onClick={() => navigate('/automations/new')}
        disabled={!operationalMode.canWrite}
        title={operationalMode.writeBlockReason ?? undefined}
      >
        {t('automationList.new', 'New')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('automationList.title', 'Automations (list)')}
      subtitle={t(
        'automationList.subtitle',
        'Bulk-manage automations. Click an automation to edit it in the builder.',
      )}
      actions={actions}
      query={automationsQuery}
    >
      <OperationalWriteNotice
        title={t(
          'automationList.readOnly.title',
          'Bulk automation controls are read-only',
        )}
      />

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('automationList.kpis', 'Automation summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('automationList.kpi.total', 'Total')}
                value={stats.total}
                icon={<Icons.workflow className="h-5 w-5" />}
              />
              <MetricCard
                label={t('automationList.kpi.active', 'Active')}
                value={stats.active}
                icon={<Icons.power className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('automationList.kpi.disabled', 'Disabled')}
                value={stats.disabled}
                icon={<Icons.pause className="h-5 w-5" />}
              />
              <MetricCard
                label={t('automationList.kpi.autoDisabled', 'Auto-disabled')}
                value={stats.autoDisabled}
                icon={<Icons.securityOff className="h-5 w-5" />}
                color="red"
              />
              <MetricCard
                label={t('automationList.kpi.runs', 'Total runs')}
                value={fmtInt(stats.totalRuns)}
                icon={<Icons.play className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('automationList.kpi.failures', 'Failures')}
                value={fmtInt(stats.totalFailures)}
                icon={<Icons.warning className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Bulk action bar (sticky; appears when rows are selected) */}
      <BulkActionToolbar
        selectedIds={effectiveSelected}
        total={filtered.length}
        onClear={clearSelection}
        itemNoun={{
          one: t('automationList.noun.one', 'automation'),
          other: t('automationList.noun.other', 'automations'),
        }}
        actions={[
          {
            id: 'enable',
            label: t('automationList.bulk.enable', 'Enable'),
            icon: <Icons.play className="h-4 w-4" />,
            disabled: !operationalMode.canWrite,
            onClick: (ids) => runBulk(ids, 'enable'),
          },
          {
            id: 'disable',
            label: t('automationList.bulk.disable', 'Disable'),
            icon: <Icons.pause className="h-4 w-4" />,
            disabled: !operationalMode.canWrite,
            onClick: (ids) => runBulk(ids, 'disable'),
          },
          {
            id: 'delete',
            label: t('automationList.bulk.delete', 'Delete'),
            variant: 'danger',
            icon: <Icons.delete className="h-4 w-4" />,
            disabled: !operationalMode.canWrite,
            confirm: {
              title: t('automationList.bulk.deleteConfirm.title', 'Delete automations?'),
              description: t(
                'automationList.bulk.deleteConfirm.body',
                'Selected automations will stop running and be removed permanently. This cannot be undone.',
              ),
              confirmLabel: t('common.delete', 'Delete'),
            },
            onClick: (ids) => runBulk(ids, 'delete'),
          },
        ]}
      />

      {/* 3 — Bento: selectable table (hero) + status-breakdown context panel */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <AutomationListTable
              automations={filtered}
              vehicleLookup={vehicleLookup}
              selectedKeys={effectiveSelected}
              onSelectionChange={setSelectedKeys}
              isLoading={isLoading}
              error={error}
              onRetry={refetch}
              totalCount={automations.length}
            />
          </div>
          <AutomationStatusPanel
            stats={stats}
            isLoading={isLoading}
            error={error}
            onRetry={refetch}
          />
        </section>
      </FadeIn>
    </PageContainer>
  );
}
