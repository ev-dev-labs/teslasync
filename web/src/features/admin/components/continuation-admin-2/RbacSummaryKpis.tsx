import { Icons } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { MetricCard } from '@/components/data-display';
import type { RbacMatrixSessionResponse } from '@/api/hooks/useRbacMatrix';
import { countGrants, permsByCategory } from './rbacPresentation';

export function RbacSummaryKpis({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation();
  const roles = payload.roles ?? [];
  const permissions = payload.permissions ?? [];
  const categories = payload.categories?.length ? payload.categories : Array.from(permsByCategory(permissions).keys());
  const allowedForMe = Object.values(payload.effective_for_me ?? {}).filter(Boolean).length;
  const myRoles = payload.my_roles ?? [];
  const grants = countGrants(payload.matrix);

  return (
    <section aria-label={t('rbac.kpi.aria', 'Matrix summary metrics')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-6">
      <MetricCard
        label={t('rbac.kpi.roles', 'Roles')}
        value={roles.length}
        icon={<Icons.users className="h-5 w-5" aria-hidden />}
        color="cyan"
      />
      <MetricCard
        label={t('rbac.kpi.permissions', 'Permissions')}
        value={permissions.length}
        icon={<Icons.keyRound className="h-5 w-5" aria-hidden />}
        color="blue"
      />
      <MetricCard
        label={t('rbac.kpi.categories', 'Categories')}
        value={categories.length}
        icon={<Icons.layers className="h-5 w-5" aria-hidden />}
        color="purple"
      />
      <MetricCard
        label={t('rbac.kpi.grants', 'Active grants')}
        value={grants}
        icon={<Icons.confirmAll className="h-5 w-5" aria-hidden />}
        color="green"
      />
      <MetricCard
        label={t('rbac.kpi.myRoles', 'My roles')}
        value={myRoles.length}
        icon={<Icons.userCircle className="h-5 w-5" aria-hidden />}
        color="amber"
      />
      <MetricCard
        label={t('rbac.kpi.effective', 'Effective for me')}
        value={`${allowedForMe} / ${permissions.length}`}
        icon={<Icons.securityCheck className="h-5 w-5" aria-hidden />}
        color="cyan"
      />
    </section>
  );
}
