import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Text } from '@/components/ui';
import type { useAuditLogPage } from '../../hooks/useAuditLogPage';

type Controller = ReturnType<typeof useAuditLogPage>;

export function AuditLogStatStrip({ controller }: { controller: Controller }) {
  const { t, logState, categoriesState, actionsState } = controller;
  const sources = [logState, categoriesState, actionsState];
  const context = (state: typeof logState | typeof categoriesState | typeof actionsState, scope: string) => (
    <div className="space-y-1">
      <Text as="span" variant="caption">{scope}</Text>
      {state.status === 'initial' && <Text as="span" variant="caption" role="status">
        {t('developerReference.stats.state.loading', 'Loading measurements')}
      </Text>}
      {state.isRefreshing && <Text as="span" variant="caption" role="status">
        {t('statstrip.audit.refreshing', 'Refreshing this source')}
      </Text>}
      {state === logState && (state.fatalError || state.refreshError) && !controller.subsystemMissing
        && <Text as="span" variant="caption" role="status">
          {state.hasData ? t('statstrip.audit.retainedEntries', 'Entries source refresh failed; retained page counts')
            : t('statstrip.audit.unavailableEntries', 'Entries source unavailable; page counts unknown')}
        </Text>}
      {state !== logState && (state.fatalError || state.refreshError) && <QueryError
        error={state.fatalError ?? state.refreshError} onRetry={() => state.retry?.()} />}
    </div>
  );
  const rowsKnown = Array.isArray(controller.logQuery.data?.rows);
  const pageScope = t('statstrip.audit.pageScope', 'Current filtered page only; not the full ledger');
  const categoryScope = t('statstrip.audit.categoryScope', 'Queried category catalog; not limited to this page');
  const actionScope = t('statstrip.audit.actionScope', 'Queried action catalog; not limited to this page');
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'entries', label: t('admin.auditLog.kpiEntries', 'Entries shown'),
      rawValue: rowsKnown ? controller.rows.length : null, context: context(logState, pageScope), description: pageScope },
    { metricId: 'count', occurrenceId: 'ok', label: t('admin.auditLog.kpiOk', 'OK (in view)'),
      rawValue: rowsKnown ? controller.okCount : null, context: context(logState, pageScope), description: pageScope },
    { metricId: 'count', occurrenceId: 'failed', label: t('admin.auditLog.kpiFailed', 'Failed (in view)'),
      rawValue: rowsKnown ? controller.failedCount : null, context: context(logState, pageScope), description: pageScope },
    { metricId: 'count', occurrenceId: 'actors', label: t('admin.auditLog.kpiActors', 'Actors (in view)'),
      rawValue: rowsKnown ? controller.distinctActors : null, context: context(logState, pageScope), description: pageScope },
    { metricId: 'count', occurrenceId: 'categories', label: t('admin.auditLog.kpiCategories', 'Categories'),
      rawValue: controller.categoriesQuery.data?.categories?.length, context: context(categoriesState, categoryScope), description: categoryScope },
    { metricId: 'count', occurrenceId: 'actions', label: t('admin.auditLog.kpiActions', 'Action types'),
      rawValue: controller.actionsQuery.data?.actions?.length, context: context(actionsState, actionScope), description: actionScope },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const retained = sources.some(source => source.hasData && (source.isRefreshing || source.status === 'stale'));
  return <FadeIn><section aria-label={t('admin.auditLog.kpis', 'Audit overview')}>
    <OperationalBrief compact metricColumns={3} testId="admin-audit-summary" metrics={operationalMetrics}
      eyebrow={t('admin.auditLog.pageTitle', 'Audit log')}
      title={t('admin.auditLog.kpis', 'Audit overview')}
      description={t('statstrip.audit.periodReason', 'Page counts follow the active filters and pagination; catalog counts use independent queries. No full-ledger period is implied.')}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : sources.some(source => source.fatalError) ? t('operationalSummary.unavailable', 'Source unavailable')
          : sources.some(source => source.status === 'initial') ? t('operationalSummary.loading', 'Loading sources')
            : t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || sources.some(source => source.fatalError) ? 'warning' : 'neutral'}
      scope={t('statstrip.audit.period', 'Current filtered page and queried catalogs')}
      freshness={retained ? t('developerReference.stats.state.retained', 'Showing retained measurements') : undefined}
      provenance={t('statstrip.audit.periodReason', 'Page counts follow the active filters and pagination; catalog counts use independent queries. No full-ledger period is implied.')} />
  </section></FadeIn>;
}
