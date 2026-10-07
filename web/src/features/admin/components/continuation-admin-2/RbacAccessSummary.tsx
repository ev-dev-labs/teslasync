import { useTranslation } from 'react-i18next';
import { ShieldCheck, UserCircle } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Badge, Caption, HelperText } from '@/components/ui';
import type { RbacMatrixSessionResponse } from '@/api/hooks/useRbacMatrix';

function EffectivePill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation();
  const allowedCount = Object.values(payload.effective_for_me ?? {}).filter(Boolean).length;
  const total = payload.permissions?.length ?? 0;
  return (
    <Badge variant={allowedCount === 0 ? 'neutral' : 'success'} data-testid="rbac-effective-pill"
      title={t('rbac.effective.tooltip', 'Permissions effective for your current roles')}>
      <ShieldCheck className="h-3 w-3" aria-hidden />
      <span>{t('rbac.effective.count', '{{count}} / {{total}} effective', { count: allowedCount, total })}</span>
    </Badge>
  );
}

function MyRolesPill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation();
  const roles = payload.my_roles ?? [];
  return (
    <Badge variant={roles.length === 0 ? 'neutral' : 'info'} data-testid="rbac-my-roles-pill">
      <UserCircle className="h-3 w-3" aria-hidden />
      {roles.length === 0 ? t('rbac.myRoles.none', 'No roles claimed')
        : t('rbac.myRoles.label', 'My roles: {{roles}}', { roles: roles.join(', ') })}
    </Badge>
  );
}

export function RbacAccessSummary({ payload, editing }: { payload: RbacMatrixSessionResponse; editing: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-testid="rbac-summary">
      <LayoutCard title={t('rbac.access.title', 'Your access')}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <MyRolesPill payload={payload} />
              <EffectivePill payload={payload} />
              {payload.groups_header_name && (
                <Caption data-testid="rbac-groups-header-name">
                  {t('rbac.groupsHeader.label', 'Groups header: {{name}}', { name: payload.groups_header_name })}
                </Caption>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25 leading-none" aria-hidden>✓</span>
                <Caption>{t('rbac.legend.allowed', 'Allowed')}</Caption>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md leading-none text-[var(--text-muted)]" aria-hidden>–</span>
                <Caption>{t('rbac.legend.denied', 'Denied')}</Caption>
              </span>
            </div>
            <HelperText>{editing ? t('rbac.legend.editHint', 'Toggle cells then Save to publish changes.')
              : t('rbac.legend.readHint', 'Read-only view — choose Edit to change bindings.')}</HelperText>
          </div>
        </div>
      </LayoutCard>
    </div>
  );
}
