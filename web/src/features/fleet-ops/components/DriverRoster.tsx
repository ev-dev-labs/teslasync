import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import {
  Button,
  DataTable,
  StatusPill,
  type Column,
} from '@/components/ui';
import type { FleetDriver } from '@/api/hooks/useFleetOps';
import type { DataState } from '@/api/dataState';

interface DriverRosterProps {
  items: FleetDriver[];
  enableValueFilters?: boolean;
  loading: boolean;
  source?: DataState<unknown>;
  pendingContent?: ReactNode;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetDriver) => void;
  onDelete: (item: FleetDriver) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

function guardrailsLabel(item: FleetDriver) {
  const parts: string[] = [];
  if (item.max_charge_soc != null) parts.push(`${item.max_charge_soc}%`);
  if (item.curfew_start && item.curfew_end) parts.push(`${item.curfew_start}–${item.curfew_end}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function DriverRoster({
  items,
  enableValueFilters = false,
  loading,
  source,
  pendingContent,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
  actionsDisabled = false,
  actionsDisabledReason,
}: DriverRosterProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<FleetDriver>[]>(() => [
    {
      key: 'name',
      header: t('fleetOps.drivers.name', 'Driver'),
      filterValue: (item) => item.id,
      filterValueLabel: (_value, item) => item.display_name,
      render: (item) => item.display_name,
      visibleOnMobile: true,
    },
    {
      key: 'reference',
      header: t('fleetOps.drivers.reference', 'Reference'),
      filterValue: (item) => item.reference_code ?? null,
      render: (item) => item.reference_code,
      visibleOnMobile: true,
    },
    {
      key: 'status',
      header: t('fleetOps.drivers.status', 'Status'),
      filterValue: (item) => item.status ?? null,
      filterValueLabel: (_value, item) => item.status == null ? '—' : item.status === 'active'
        ? t('fleetOps.drivers.active', 'Active') : t('fleetOps.drivers.inactive', 'Inactive'),
      render: (item) => (
        <StatusPill color={item.status === 'active' ? 'bg-[var(--semantic-success)]' : 'bg-[var(--text-secondary)]'}>
          {item.status === 'active'
            ? t('fleetOps.drivers.active', 'Active')
            : t('fleetOps.drivers.inactive', 'Inactive')}
        </StatusPill>
      ),
    },
    {
      key: 'guardrails',
      header: t('fleetOps.drivers.guardrails', 'Guardrails'),
      render: guardrailsLabel,
    },
    {
      key: 'actions',
      header: t('common.actions', 'Actions'),
      render: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 px-0"
            aria-label={t('fleetOps.drivers.edit', 'Edit {{name}}', { name: item.display_name })}
            disabled={actionsDisabled}
            title={actionsDisabledReason}
            onClick={() => onEdit(item)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 px-0 text-[var(--semantic-danger)]"
            aria-label={t('fleetOps.drivers.delete', 'Delete {{name}}', { name: item.display_name })}
            disabled={actionsDisabled}
            title={actionsDisabledReason}
            onClick={() => onDelete(item)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      align: 'right',
    },
  ], [actionsDisabled, actionsDisabledReason, onDelete, onEdit, t]);

  return (
    <LayoutCard title={t('fleetOps.drivers.title', 'Fleet drivers')} actions={
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          icon={<Plus className="h-4 w-4" />}
          onClick={onAdd}
          disabled={actionsDisabled}
          title={actionsDisabledReason}
        >
          {t('fleetOps.drivers.add', 'Add driver')}
        </Button>
      }>
      {source?.hasData !== true && error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.drivers.resource', 'Drivers')} />
      ) : source && !source.hasData ? (
        pendingContent
      ) : !source && loading ? <Skeleton lines={5} /> : items.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-8 w-8" />}
          message={t('fleetOps.drivers.empty', 'No fleet drivers are configured.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.drivers.add', 'Add driver'), onClick: onAdd }}
        />
      ) : (
        <DataTable
          tableId="fleet-ops:drivers"
          caption={t('fleetOps.drivers.title', 'Fleet drivers')}
          columns={columns}
          data={items}
          enableValueFilters={enableValueFilters}
          keyExtractor={(item) => item.id}
          mobileColumns={['name', 'reference', 'actions']}
          mobilePresentation={{
            roles: { name: 'title', reference: 'primary', status: 'badge', guardrails: 'meta' },
            displayValue: (item, key) => {
              switch (key) {
                case 'name': return item.display_name;
                case 'reference': return item.reference_code;
                case 'status': return item.status === 'active'
                  ? t('fleetOps.drivers.active', 'Active') : t('fleetOps.drivers.inactive', 'Inactive');
                case 'guardrails': return guardrailsLabel(item);
                default: return null;
              }
            },
            inlineActions: (item) => columns.find((column) => column.key === 'actions')?.render(item),
          }}
          pagination
        />
      )}
    </LayoutCard>
  );
}
