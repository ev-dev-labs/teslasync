/**
 * Audit-log browser and hash-chain verification surface.
 *
 * Full-width modern-ui cockpit: a derived KPI band, a controls bento
 * (filters + hash-chain integrity), and a full-bleed entries table with
 * expandable rows and CSV export. Filters are page-controller state so the query
 * URL reproduces the view.
 *
 * Backed by:
 *   GET /admin/audit-log            (filtered list)
 *   GET /admin/audit-log/categories (filter dropdown)
 *   GET /admin/audit-log/actions    (filter dropdown)
 *   GET /admin/audit-log/verify     (chain re-derivation)
 *
 * The shared request() client prepends /api/v1, so the hook URLs above
 * carry no prefix. See internal/handler/v1/admin_audit_handler.go and
 * internal/api/router.go (~L3867).
 */
import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { DataStateNotice } from '@/components/feedback';
import { useAuditLogPage } from '../hooks/useAuditLogPage';
import { AuditLogStatStrip } from '../components/statstrip-audit-vehicle-cost/AuditLogStatStrip';
import { AuditLogFilters } from '../components/structural-closure/audit-log/AuditLogFilters';
import { AuditLogIntegrity } from '../components/structural-closure/audit-log/AuditLogIntegrity';
import { AuditLogEntries } from '../components/structural-closure/audit-log/AuditLogEntries';

export default function AuditLogPage() {
  const controller = useAuditLogPage();
  const { t, logQuery, categoriesQuery, actionsQuery, verifyQuery, verifyState, subsystemMissing } = controller;
  return (
    <PageLayout
      title={t('admin.auditLog.pageTitle', 'Audit log')}
      subtitle={t(
        'admin.auditLog.subtitle',
        'Append-only audit ledger with SHA-256 hash chaining. Narrow the scope with the filter row and verify the chain to re-derive integrity on demand.',
      )}
      query={logQuery}
      dataSources={[
        { id: 'audit-entries', label: t('admin.auditLog.tableTitle', 'Entries'), query: logQuery },
        { id: 'audit-categories', label: t('admin.auditLog.kpiCategories', 'Categories'), query: categoriesQuery },
        { id: 'audit-actions', label: t('admin.auditLog.kpiActions', 'Action types'), query: actionsQuery },
        { id: 'audit-integrity', label: t('admin.auditLog.integrityTitle', 'Hash chain integrity'), query: verifyQuery, enabled: verifyQuery.isFetching || verifyState.hasData || Boolean(verifyState.fatalError) },
      ]}
    >
      {subsystemMissing && (
        <DataStateNotice
          state="unsupported"
          title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}
        >
          {t(
            'admin.auditLog.notConfigured',
            'The audit log subsystem is not configured on this deployment.',
          )}
        </DataStateNotice>
      )}

      <AuditLogStatStrip controller={controller} />
      {/* Filters and verification retain independent source recovery. */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <AuditLogFilters controller={controller} />
          <AuditLogIntegrity controller={controller} />
        </section>
      </FadeIn>
      <AuditLogEntries controller={controller} />
    </PageLayout>
  );
}
