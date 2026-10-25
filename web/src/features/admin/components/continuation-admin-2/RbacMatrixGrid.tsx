import { Icons } from '@/lib/icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, DataTable, Text, Caption, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { RbacMatrixSessionResponse, RbacPermission, RbacRole } from '@/api/hooks/useRbacMatrix';
import { permsByCategory, type MatrixDraft } from './rbacPresentation';

interface MatrixCellProps {
  roleID: string;
  permID: string;
  allowed: boolean;
  editing: boolean;
  onToggle: (roleID: string, permID: string, next: boolean) => void;
}

function MatrixCell({ roleID, permID, allowed, editing, onToggle }: MatrixCellProps) {
  const { t } = useTranslation();
  if (editing) {
    return (
      <Checkbox
        checked={allowed}
        onChange={(next) => onToggle(roleID, permID, next)}
        aria-label={t('rbac.cell.toggle', 'Toggle {{role}} / {{perm}}', { role: roleID, perm: permID })}
        data-testid={`rbac-cell-edit-${roleID}-${permID}`}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md px-1 tabular-nums leading-none',
        allowed ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25' : 'text-[var(--text-muted)]',
      )}
      aria-label={allowed ? t('rbac.cell.allowed', 'Allowed') : t('rbac.cell.denied', 'Denied')}
      data-testid={`rbac-cell-${roleID}-${permID}`}
    >
      {allowed ? '✓' : '–'}
    </span>
  );
}

interface RbacMatrixGridProps {
  payload: RbacMatrixSessionResponse;
  draft: MatrixDraft;
  editing: boolean;
  onToggle: (roleID: string, permID: string, next: boolean) => void;
}

export function RbacMatrixGrid({ payload, draft, editing, onToggle }: RbacMatrixGridProps) {
  const { t } = useTranslation();
  const roles = payload.roles ?? [];
  const grouped = useMemo(() => permsByCategory(payload.permissions ?? []), [payload.permissions]);
  const orderedCategories = (payload.categories?.length ? payload.categories : Array.from(grouped.keys()))
    .filter((cat) => (grouped.get(cat)?.length ?? 0) > 0);
  const orderedPermissions = useMemo<RbacPermission[]>(
    () => orderedCategories.flatMap((category) => grouped.get(category) ?? []),
    [grouped, orderedCategories],
  );
  const firstPermissionByCategory = useMemo(
    () => new Map(orderedCategories.map((category) => [
      category,
      (grouped.get(category)?.[0]?.id ?? ''),
    ])),
    [grouped, orderedCategories],
  );
  const columns = useMemo<Column<RbacPermission>[]>(
    () => [
      {
        key: 'permission',
        header: t('rbac.permissionColumn', 'Permission'),
        className: 'sticky start-0 z-[1] min-w-44',
        render: (permission) => (
          <div className="space-y-1">
            {firstPermissionByCategory.get(permission.category) === permission.id && (
              <span
                role="rowheader"
                {...({ scope: 'rowgroup' } as { scope: string })}
                data-testid={`rbac-category-row-${permission.category}`}
              >
                <Text variant="label" className="block rounded-md bg-[var(--surface-2)] px-2 py-1 tracking-widest">
                  {t(`rbac.category.${permission.category}`, permission.category)}
                </Text>
              </span>
            )}
            <Text as="span" variant="body">{permission.name}</Text>
            <Caption>{permission.id}</Caption>
          </div>
        ),
      },
      ...roles.map<Column<RbacPermission>>((role: RbacRole) => ({
        key: role.id,
        header: role.name,
        headerTestId: `rbac-col-${role.id}`,
        align: 'center',
        className: 'min-w-20 text-center',
        render: (permission) => (
          <MatrixCell
            roleID={role.id}
            permID={permission.id}
            allowed={draft.cells[role.id]?.[permission.id] ?? false}
            editing={editing}
            onToggle={onToggle}
          />
        ),
      })),
    ],
    [draft, editing, firstPermissionByCategory, onToggle, roles, t],
  );

  if (roles.length === 0 || orderedCategories.length === 0) {
    return (
      // no-action: the owning page already refreshes the matrix; this grid cannot create provider roles or permissions.
      <EmptyState
        icon={<Icons.securityCheck className="h-8 w-8" aria-hidden />}
        message={t('rbac.matrix.empty', 'No permissions to display for the current roles.')}
      />
    );
  }

  return (
    <div className="min-w-0" data-testid="rbac-matrix-scroll">
      <DataTable<RbacPermission>
        testId="rbac-matrix-grid"
        tableId="admin:rbac-matrix"
        name={t('rbac.matrix.aria', 'Role permission matrix')}
        caption={t('rbac.matrix.aria', 'Role permission matrix')}
        variant="embedded"
        data={orderedPermissions}
        keyExtractor={(permission) => permission.id}
        getRowTestId={(permission) => `rbac-row-${permission.id}`}
        mobileColumns={['permission']}
        columns={columns}
      />
    </div>
  );
}
