import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Plus } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { GlassPanel, Pagination, Select, type SelectOption } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useAutomations, useAutomationHistoryPage } from '@/api/hooks/useAutomations';
import type { AutomationHistoryStatus } from '@/api/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
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
  usePageTitle(t('automations.historyPage.title', 'Automation History'));
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
    since: startInstant, until: endInstantExclusive,
  });
  const automations = useAutomations();
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
  const isInitialLoading = query.isLoading && !data;
  const initialError = query.isError && !data;

  useEffect(() => {
    if (data && page > totalPages) updateFilter('page', String(totalPages));
  }, [data, page, totalPages]);

  return (
    <PageContainer
      title={t('automations.historyPage.title', 'Automation History')}
      subtitle={t('automations.historyPage.subtitle', 'Review every execution and its outcome across the selected period.')}
      copyLink
      actions={
        <Link to="/automations/new" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('automations.historyPage.new', 'New automation')}
        </Link>
      }
    >
      <FadeIn>
        <AutomationHistorySummary query={query} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <AutomationHistoryTrend query={query} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select
              options={options}
              value={automationId ? String(automationId) : ''}
              onChange={(event) => updateFilter('automation_id', event.target.value)}
              aria-label={t('automations.historyPage.filterRule', 'Filter executions by rule')}
              className="min-w-44 flex-1 sm:max-w-72"
            />
            <Select
              options={statusOptions}
              value={status ?? ''}
              onChange={(event) => updateFilter('status', event.target.value)}
              aria-label={t('automations.historyPage.filterStatus', 'Filter executions by status')}
              className="min-w-40 flex-1 sm:max-w-60"
            />
          </div>
          {automations.isError && (
            <QueryError error={automations.error} onRetry={() => { void automations.refetch(); }} />
          )}
          {isInitialLoading ? (
            <div className="space-y-3" aria-label={t('automations.historyPage.loading', 'Loading executions')}>
              {[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
            </div>
          ) : initialError ? (
            <QueryError error={query.error} onRetry={() => { void query.refetch(); }} />
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
          {query.isError && data && (
            <QueryError error={query.error} onRetry={() => { void query.refetch(); }} />
          )}
        </GlassPanel>
      </FadeIn>
      <AutomationExecutionDetail id={selectedId} onClose={() => setSelectedId(null)} />
    </PageContainer>
  );
}
