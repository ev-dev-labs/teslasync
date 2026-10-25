import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Plus } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { BUTTON_BASE, BUTTON_VARIANTS, GlassPanel, Icon, Pagination, Select, type SelectOption } from '@/components/ui';
import { DataSourceNotice, DataStateNotice, EmptyState, QueryError, Skeleton, StaleRefreshWarning, resolveDataSourceStatus } from '@/components/feedback';
import { useAutomations, useAutomationHistoryPage } from '@/api/hooks/useAutomations';
import type { AutomationHistoryStatus } from '@/api/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { AutomationHistorySummary } from '../components/AutomationHistorySummary';
import { AutomationHistoryTrend } from '../components/AutomationHistoryTrend';
import { AutomationHistoryTable } from '../components/AutomationHistoryTable';
import { AutomationExecutionDetail } from '../components/AutomationExecutionDetail';

const PAGE_SIZE = 25;
const STATUSES: AutomationHistoryStatus[] = [
  'running', 'success', 'partial', 'failed', 'skipped', 'cancelled', 'test', 'undo',
];

export default function AutomationHistoryPage() {
  const { t } = useTranslation();
  const { tz } = useDateFormat();
  usePageTitle(t('automations.historyPage.title', 'Automation history'));
  const { startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'automations.history.range',
  });
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const automationIdRaw = Number(params.get('automation_id'));
  const automationId = Number.isSafeInteger(automationIdRaw) && automationIdRaw > 0
    ? automationIdRaw : undefined;
  const statusRaw = params.get('status');
  const status = STATUSES.find((value) => value === statusRaw);
  const pageRaw = Number(params.get('page'));
  const page = Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const query = useAutomationHistoryPage({
    page, pageSize: PAGE_SIZE, automationId, status,
    since: startInstant, until: endInstantExclusive, timezone: tz,
  });
  const automations = useAutomations();
  const historyState = useDataState({ ...query, data: query.data ?? undefined });
  const rulesState = useDataState(automations);
  const options = useMemo<SelectOption[]>(() => [
    { value: '', label: t('automations.historyPage.allRules', 'All rules') },
    ...(automations.data ?? []).map((rule) => ({
      value: String(rule.id), label: rule.name,
    })),
    ...(automationId && !(automations.data ?? []).some((rule) => rule.id === automationId)
      ? [{ value: String(automationId), label: t('automations.historyPage.ruleId', 'Rule #{{id}}', { id: automationId }) }]
      : []),
  ], [automationId, automations.data, t]);
  const statusOptions = useMemo<SelectOption[]>(() => [
    { value: '', label: t('automations.historyPage.allStatuses', 'All statuses') },
    ...STATUSES.map((value) => ({
      value,
      label: t(`automations.historyPage.status.${value}`, value),
    })),
  ], [t]);

  function updateFilter(key: 'automation_id' | 'status' | 'page', value: string) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }

  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const rows = data?.items ?? [];
  const historySource = {
    id: 'history',
    label: t('automations.historyPage.title', 'Automation history'),
    query: { ...query, data: query.data ?? undefined },
  };
  const rulesSource = {
    id: 'rules',
    label: t('automations.historyPage.filterRule', 'Filter executions by rule'),
    query: automations,
  };
  const isInitialLoading = resolveDataSourceStatus(historySource) === 'loading';
  const initialError = historyState.fatalError;

  useEffect(() => {
    if (data && page > totalPages) updateFilter('page', String(totalPages));
  }, [data, page, totalPages]);

  return (
    <PageLayout
      title={t('automations.historyPage.title', 'Automation history')}
      subtitle={t('automations.historyPage.subtitle', 'Review every execution and its outcome across the selected period.')}
      copyLink
      primaryAction={
        <Link
          to="/automations/new"
          className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, typography.size.sm,
            'min-h-11 min-w-11 max-w-full px-3 py-2 md:min-h-9 whitespace-normal')}
        >
          <Icon icon={Plus} />
          <span className="min-w-0 break-words">{t('automations.historyPage.new', 'New automation')}</span>
        </Link>
      }
    >
      <FadeIn>
        <AutomationHistorySummary
          query={query}
          scope={t('automations.historyBrief.bounds', '{{start}} inclusive → {{end}} exclusive · rule: {{rule}} · status: {{status}}', {
            start: startInstant, end: endInstantExclusive,
            rule: automationId ? options.find((option) => option.value === String(automationId))?.label
              : t('automations.historyPage.allRules', 'All rules'),
            status: status ? statusOptions.find((option) => option.value === status)?.label
              : t('automations.historyPage.allStatuses', 'All statuses'),
          })}
        />
      </FadeIn>
      <FadeIn delay={0.05}>
        <AutomationHistoryTrend query={query} />
        <StaleRefreshWarning state={historyState} label={t('automations.historyPage.title', 'Automation history')} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-full min-w-0 sm:flex-1 sm:max-w-72">
              <Select
                options={options}
                value={automationId ? String(automationId) : ''}
                onChange={(event) => updateFilter('automation_id', event.target.value)}
                label={t('automations.historyPage.filterRule', 'Filter executions by rule')}
                aria-label={t('automations.historyPage.filterRule', 'Filter executions by rule')}
              />
            </div>
            <div className="w-full min-w-0 sm:flex-1 sm:max-w-60">
              <Select
                options={statusOptions}
                value={status ?? ''}
                onChange={(event) => updateFilter('status', event.target.value)}
                label={t('automations.historyPage.filterStatus', 'Filter executions by status')}
                aria-label={t('automations.historyPage.filterStatus', 'Filter executions by status')}
              />
            </div>
          </div>
          <StaleRefreshWarning state={rulesState} label={t('automations.historyPage.filterRule', 'Filter executions by rule')} />
          {rulesState.fatalError && (
            <QueryError error={rulesState.fatalError} onRetry={() => { void automations.refetch(); }} />
          )}
          {!rulesState.hasData && !rulesState.fatalError && (
            resolveDataSourceStatus(rulesSource) === 'loading' ? (
              <Skeleton className="mb-4 h-12 w-full" aria-label={rulesSource.label} />
            ) : rulesState.isRefreshBlocked ? (
              <DataSourceNotice sources={[rulesSource]} />
            ) : (
              <DataStateNotice
                state="unavailable"
                title={rulesSource.label}
                message={t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
              />
            )
          )}
          {isInitialLoading ? (
            <div className="space-y-3" aria-label={t('automations.historyPage.loading', 'Loading executions')}>
              {[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
            </div>
          ) : initialError ? (
            <QueryError error={initialError} onRetry={() => { void query.refetch(); }} />
          ) : !historyState.hasData ? (
            historyState.isRefreshBlocked ? (
              <DataSourceNotice sources={[historySource]} />
            ) : (
              <DataStateNotice
                state="unavailable"
                title={historySource.label}
                message={t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
              />
            )
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-8 w-8" aria-hidden="true" />}
              message={t('automations.historyPage.empty', 'No executions match this period and filters.')}
              actionTo={{ label: t('automations.historyPage.manage', 'Manage automation rules'), to: '/automations/list' }}
            />
          ) : (
            <>
              <AutomationHistoryTable rows={rows} onOpen={setSelectedId} />
              <Pagination
                page={effectivePage}
                pageSize={PAGE_SIZE}
                total={data?.total ?? 0}
                onPageChange={(next) => updateFilter('page', next === 1 ? '' : String(next))}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
      <AutomationExecutionDetail id={selectedId} onClose={() => setSelectedId(null)} />
    </PageLayout>
  );
}
