import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Checkbox, Table, Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { RbacMatrixSessionResponse, RbacRole } from '@/api/hooks/useRbacMatrix';
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

  if (roles.length === 0 || orderedCategories.length === 0) {
    return (
      // no-action: the owning page already refreshes the matrix; this grid cannot create provider roles or permissions.
      <EmptyState
        icon={<ShieldCheck className="h-8 w-8" aria-hidden />}
        message={t('rbac.matrix.empty', 'No permissions to display for the current roles.')}
      />
    );
  }

  return (
    <div className="min-w-0" data-testid="rbac-matrix-scroll">
      <Table aria-label={t('rbac.matrix.aria', 'Role permission matrix')} data-testid="rbac-matrix-grid">
        <thead>
          <tr>
            <th scope="col" className="sticky start-0 z-[1] min-w-44 bg-[var(--surface-2)]">
              <Text variant="label">{t('rbac.permissionColumn', 'Permission')}</Text>
            </th>
            {roles.map((role: RbacRole) => (
              <th
                key={role.id}
                scope="col"
                data-testid={`rbac-col-${role.id}`}
                className="min-w-20 text-center"
              >
                <Text variant="label" className="break-words" title={role.name}>{role.name}</Text>
              </th>
            ))}
          </tr>
        </thead>
        {orderedCategories.map((cat) => {
          const items = grouped.get(cat) ?? [];
          return (
            <tbody key={`cat-${cat}`}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 1}
                  data-testid={`rbac-category-row-${cat}`}
                  className="bg-[var(--surface-2)]"
                >
                  <Text variant="label" className="tracking-widest">{t(`rbac.category.${cat}`, cat)}</Text>
                </th>
              </tr>
              {items.map((perm) => (
                <tr key={perm.id} data-testid={`rbac-row-${perm.id}`}>
                  <th scope="row" className="sticky start-0 z-[1] bg-[var(--surface-2)]">
                    <Text as="span" variant="body">{perm.name}</Text>
                    <Caption>{perm.id}</Caption>
                  </th>
                  {roles.map((role: RbacRole) => (
                    <td key={role.id} className="text-center">
                      <MatrixCell
                        roleID={role.id}
                        permID={perm.id}
                        allowed={draft.cells[role.id]?.[perm.id] ?? false}
                        editing={editing}
                        onToggle={onToggle}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          );
        })}
      </Table>
    </div>
  );
}
