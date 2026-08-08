import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import {
  Button,
  DataTable,
  GlassPanel,
  PanelTitle,
  StatusPill,
  type Column,
} from '@/components/ui';
import type { FleetDriver } from '@/api/hooks/useFleetOps';

interface DriverRosterProps {
  items: FleetDriver[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetDriver) => void;
  onDelete: (item: FleetDriver) => void;
}

export function DriverRoster({
  items,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
}: DriverRosterProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<FleetDriver>[]>(() => [
    {
      key: 'name',
      header: t('fleetOps.drivers.name', 'Driver'),
      render: (item) => item.display_name,
      visibleOnMobile: true,
    },
    {
      key: 'reference',
      header: t('fleetOps.drivers.reference', 'Reference'),
      render: (item) => item.reference_code,
      visibleOnMobile: true,
    },
    {
      key: 'status',
      header: t('fleetOps.drivers.status', 'Status'),
      render: (item) => (
        <StatusPill color={item.status === 'active' ? 'bg-emerald-500' : 'bg-slate-500'}>
          {item.status === 'active'
            ? t('fleetOps.drivers.active', 'Active')
            : t('fleetOps.drivers.inactive', 'Inactive')}
        </StatusPill>
      ),
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
            onClick={() => onEdit(item)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 px-0 text-rose-300"
            aria-label={t('fleetOps.drivers.delete', 'Delete {{name}}', { name: item.display_name })}
            onClick={() => onDelete(item)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      align: 'right',
    },
  ], [onDelete, onEdit, t]);

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <PanelTitle>{t('fleetOps.drivers.title', 'Fleet drivers')}</PanelTitle>
        <Button type="button" size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
          {t('fleetOps.drivers.add', 'Add driver')}
        </Button>
      </div>
      {loading ? <Skeleton lines={5} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.drivers.resource', 'Drivers')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-8 w-8" />}
          message={t('fleetOps.drivers.empty', 'No fleet drivers are configured.')}
          action={{ label: t('fleetOps.drivers.add', 'Add driver'), onClick: onAdd }}
        />
      ) : (
        <DataTable
          tableId="fleet-ops:drivers"
          columns={columns}
          data={items}
          keyExtractor={(item) => item.id}
          mobileColumns={['name', 'reference', 'actions']}
          pagination
        />
      )}
    </GlassPanel>
  );
}
