import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { RbacMatrixSessionResponse } from '@/api/hooks/useRbacMatrix';
import { countGrants, permsByCategory } from '../continuation-admin-2/rbacPresentation';
import { briefSource, type BriefSource } from './briefSource';

export function RbacOperationalBrief({ payload, source }: {
  payload?: RbacMatrixSessionResponse; source: BriefSource;
}) {
  const { t } = useTranslation();
  const permissions = payload?.permissions ?? [];
  const categories = payload?.categories?.length ? payload.categories : Array.from(permsByCategory(permissions).keys());
  const scope = t('rbac.brief.scope', 'Saved provider bindings and permissions for your current authenticated roles; unsaved edits are not included.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'rbac-roles', rawValue: payload ? (payload.roles ?? []).length : null,
      label: t('rbac.kpi.roles', 'Roles'), description: scope },
    { metricId: 'count', occurrenceId: 'rbac-permissions', rawValue: payload ? permissions.length : null,
      label: t('rbac.kpi.permissions', 'Permissions'), description: scope },
    { metricId: 'count', occurrenceId: 'rbac-categories', rawValue: payload ? categories.length : null,
      label: t('rbac.kpi.categories', 'Categories'), description: scope },
    { metricId: 'count', occurrenceId: 'rbac-grants', rawValue: payload ? countGrants(payload.matrix) : null,
      label: t('rbac.kpi.grants', 'Active grants'), description: scope },
    { metricId: 'count', occurrenceId: 'rbac-my-roles', rawValue: payload ? (payload.my_roles ?? []).length : null,
      label: t('rbac.kpi.myRoles', 'My roles'), description: scope },
    { metricId: 'count', occurrenceId: 'rbac-effective', rawValue: payload ? Object.values(payload.effective_for_me ?? {}).filter(Boolean).length : null,
      display: { countTotal: payload ? permissions.length : undefined,
        formatter: value => ({ value: `${value} / ${permissions.length}`, unit: '' }) },
      label: t('rbac.kpi.effective', 'Effective for me'), description: scope },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <OperationalBrief compact testId="rbac-operational-brief" metrics={operationalMetrics}
    eyebrow={t('rbac.title', 'RBAC matrix')} title={t('rbac.kpi.aria', 'Matrix summary metrics')}
    description={scope} scope={t('admin.operationalBrief.periodUnknown', 'Observation time and complete analysis bounds are not supplied by this source.')}
    provenance={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
    {...briefSource(t, source)} loading={source.loading && !source.retained} />;
}
