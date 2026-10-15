import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Pause, Play, Plus, Search, Trash2 } from 'lucide-react';

import { Button, GlassPanel, Icon, Input, Select, Text, type SelectOption } from '@/components/ui';
import { BulkActionToolbar } from '@/components/data-display';
import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AlertBanner, DataSourceNotice, OperationalWriteNotice, QueryError, StaleRefreshWarning } from '@/components/feedback';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useAutomationList, automationNumber, automationStatus, useBulkAutomationsUpdate, type AutomationBulkResult, type AutomationListItem } from '@/api/hooks/useAutomations';
import { useVehicles } from '@/api/hooks/useVehicles';
import { AutomationListTable } from './AutomationListTable';
import { AutomationStatusPanel } from './AutomationStatusPanel';
import { RoutineWizard } from '../components/RoutineWizard';
import { AutomationRulesBrief } from '../components/operationalbrief-all/AutomationRulesBrief';

type RowKey = string | number;
type StatusFilter = 'all' | 'active' | 'disabled' | 'auto-disabled';

export default function AutomationListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('automationList.title', 'Automation rules'));

  const automationsQuery = useAutomationList();
  const { data: rowsRaw, refetch } = automationsQuery;
  const automationsState = useDataState(automationsQuery);
  const isLoading = !automationsState.hasData && !automationsState.fatalError && !automationsState.isRefreshBlocked && (automationsQuery.isLoading || automationsQuery.isFetching);
  const error = automationsState.fatalError;
  const automations: AutomationListItem[] = useMemo(() => rowsRaw ?? [], [rowsRaw]);

  const vehiclesQuery = useVehicles();
  const vehiclesState = useDataState(vehiclesQuery);
  const { data: vehiclesRaw } = vehiclesQuery;
  const vehicleLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of vehiclesRaw ?? []) map.set(v.id, v.display_name || v.vin);
    return map;
  }, [vehiclesRaw]);

  const bulkUpdate = useBulkAutomationsUpdate();
  const operationalMode = useOperationalMode();
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
        return automationStatus(a) === statusFilter;
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

  const stats = useMemo(() => {
    let active: number | undefined = 0;
    let disabled: number | undefined = 0;
    let autoDisabled: number | undefined = 0;
    let totalRuns: number | undefined = 0;
    let totalFailures: number | undefined = 0;
    for (const a of automations) {
      const status = automationStatus(a);
      if (status == null) active = disabled = autoDisabled = undefined;
      else if (status === 'auto-disabled' && autoDisabled != null) autoDisabled += 1;
      else if (status === 'active' && active != null) active += 1;
      else if (status === 'disabled' && disabled != null) disabled += 1;
      const runs = automationNumber(a.execution_count);
      const failures = automationNumber(a.failure_count);
      totalRuns = totalRuns != null && runs != null ? totalRuns + runs : undefined;
      totalFailures = totalFailures != null && failures != null ? totalFailures + failures : undefined;
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

  const [selectedKeys, setSelectedKeys] = useState<RowKey[]>([]);
  const [bulkFailures, setBulkFailures] = useState<AutomationBulkResult['failed']>([]);
  const loadedIdSet = useMemo(() => new Set(automations.map((a) => a.id)), [automations]);
  const effectiveSelected = useMemo(
    () => selectedKeys.filter((k) => loadedIdSet.has(Number(k))),
    [selectedKeys, loadedIdSet],
  );
  const selectedReview = effectiveSelected.map((key) => {
    const row = automations.find((a) => a.id === Number(key));
    return `#${key}: ${row?.name ?? t('automationList.unnamed', 'Untitled automation')}`;
  }).join('\n');
  const clearSelection = useCallback(() => setSelectedKeys([]), []);
  const runBulk = useCallback(
    async (ids: RowKey[], op: 'enable' | 'disable' | 'delete') => {
      try {
        const submitted = new Set(ids.map(Number));
        const result = await bulkUpdate.mutateAsync({ ids: [...submitted], op });
        const failed = result.failed ?? [];
        const failedIds = new Set(failed.map((failure) => failure.id));
        setBulkFailures(failed);
        // A partial HTTP-success is not confirmation for its failed IDs.
        setSelectedKeys((current) => current.filter(
          (key) => !submitted.has(Number(key)) || failedIds.has(Number(key)),
        ));
      } catch {
        // The hook owns failure toasts; keep selection without an unhandled rejection.
      }
    },
    [bulkUpdate],
  );
  const contextActions = (
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
        icon={<Icon icon={Search} />}
        className="w-full sm:w-56"
      />
    </div>
  );

  return (
    <PageLayout
      title={t('automationList.title', 'Automation rules')}
      subtitle={t(
        'automationList.subtitle',
        'Bulk-manage automations. Click an automation to edit it in the builder.',
      )}
      contextActions={contextActions}
      primaryAction={
        <Button
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => navigate('/automations/new')}
          disabled={!operationalMode.canWrite}
          title={operationalMode.writeBlockReason ?? undefined}
        >
          {t('automationList.new', 'New')}
        </Button>
      }
      query={automationsQuery}
    >
      <OperationalWriteNotice
        title={t(
          'automationList.readOnly.title',
          'Bulk automation controls are read-only',
        )}
      />
      <StaleRefreshWarning state={automationsState} label={t('automationList.title', 'Automation rules')} />
      <StaleRefreshWarning state={vehiclesState} label={t('nav.groups.vehicles', 'Vehicles')} />
      {vehiclesState.isRefreshing && (
        <Text role="status" aria-busy="true" color="secondary">
          {t('nav.groups.vehicles', 'Vehicles')}: {t('freshness.updating', 'Updating…')}
        </Text>
      )}
      {vehiclesState.fatalError && (
        <QueryError
          error={vehiclesState.fatalError}
          resourceName={t('nav.groups.vehicles', 'Vehicles')}
          onRetry={() => vehiclesQuery.refetch()}
        />
      )}
      {!vehiclesState.hasData && !vehiclesState.fatalError && !vehiclesState.isRefreshBlocked && (vehiclesQuery.isLoading || vehiclesQuery.isFetching) && (
        <Text role="status" color="secondary">{t('common.loading', 'Loading...')}</Text>
      )}
      {!vehiclesState.hasData && vehiclesState.isRefreshBlocked && !vehiclesState.fatalError && (
        <DataSourceNotice sources={[{ id: 'automation-vehicles', label: t('nav.groups.vehicles', 'Vehicles'), query: vehiclesQuery }]} />
      )}
      {bulkFailures.length > 0 && (
        <AlertBanner variant="warning" role="status" aria-live="polite"
          title={t('common.error', 'Error')}>
          <ul className="space-y-1">
            {bulkFailures.map((failure) => (
              <li key={failure.id}>
                <Text as="span" color="secondary">#{failure.id}: {failure.reason}</Text>
              </li>
            ))}
          </ul>
        </AlertBanner>
      )}

      <FadeIn>
        <section aria-label={t('automationList.kpis', 'Automation summary')}>
          <AutomationRulesBrief
            bulk stats={stats} hasData={automationsState.hasData}
            loading={isLoading}
            retained={Boolean(automationsState.refreshError || automationsState.isRefreshBlocked)}
          />
          {error && (
            <QueryError
              error={error}
              onRetry={() => refetch()}
              className="col-span-2 lg:col-span-3 3xl:col-span-6"
            />
          )}
        </section>
      </FadeIn>

      <BulkActionToolbar
        selectedIds={effectiveSelected}
        total={automations.length}
        selectionScope="loaded"
        selectionSummary={
          <span className="whitespace-pre-line">
            {t('bulk.selected', { count: effectiveSelected.length, defaultValue: '{{count}} selected' })}
            {' · '}{t('automations.brief.scope', 'All loaded rules · unfiltered')}
            {'\n'}{selectedReview}
          </span>
        }
        onClear={clearSelection}
        itemNoun={{
          one: t('automationList.noun.one', 'automation'),
          other: t('automationList.noun.other', 'automations'),
        }}
        actions={[
          {
            id: 'enable',
            label: t('automationList.bulk.enable', 'Enable'),
            icon: <Icon icon={Play} />,
            disabled: !operationalMode.canWrite,
            disabledReason: operationalMode.writeBlockReason ?? undefined,
            confirm: {
              title: t('automationList.bulk.enable', 'Enable'),
              description: selectedReview,
              confirmLabel: t('automationList.bulk.enable', 'Enable'),
            },
            onClick: (ids) => runBulk(ids, 'enable'),
          },
          {
            id: 'disable',
            label: t('automationList.bulk.disable', 'Disable'),
            icon: <Icon icon={Pause} />,
            disabled: !operationalMode.canWrite,
            disabledReason: operationalMode.writeBlockReason ?? undefined,
            confirm: {
              title: t('automationList.bulk.disable', 'Disable'),
              description: selectedReview,
              confirmLabel: t('automationList.bulk.disable', 'Disable'),
            },
            onClick: (ids) => runBulk(ids, 'disable'),
          },
          {
            id: 'delete',
            label: t('automationList.bulk.delete', 'Delete'),
            variant: 'danger',
            icon: <Icon icon={Trash2} />,
            disabled: !operationalMode.canWrite,
            disabledReason: operationalMode.writeBlockReason ?? undefined,
            confirm: {
              title: t('automationList.bulk.deleteConfirm.title', 'Delete automations?'),
              description: `${t(
                'automationList.bulk.deleteConfirm.body',
                'Selected automations will stop running and be removed permanently. This cannot be undone.',
              )}\n\n${selectedReview}`,
              confirmLabel: t('common.delete', 'Delete'),
            },
            onClick: (ids) => runBulk(ids, 'delete'),
          },
        ]}
      />

      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <AutomationListTable
              automations={filtered}
              vehicleLookup={vehicleLookup}
              selectedKeys={effectiveSelected}
              onSelectionChange={setSelectedKeys}
              isLoading={isLoading}
              error={error}
              onRetry={refetch}
              totalCount={automations.length}
              hasData={automationsState.hasData}
              dataState={automationsState}
            />
          </div>
          <AutomationStatusPanel
            stats={{ ...stats, total: automationsState.hasData ? stats.total : undefined }}
            isLoading={isLoading}
            error={error}
            onRetry={refetch}
            dataState={automationsState}
          />
        </section>
      </FadeIn>
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <RoutineWizard actionsDisabled={!operationalMode.canWrite} />
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
