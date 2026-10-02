import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button, DataTable, GlassPanel, PanelTitle, StatusPill, type Column } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import type { FleetAssignment } from '@/api/hooks/useFleetOps';

interface AssignmentRosterProps {
  items: FleetAssignment[];
  enableValueFilters?: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetAssignment) => void;
  onDelete: (item: FleetAssignment) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

export function AssignmentRoster({
  items,
  enableValueFilters = false,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
  actionsDisabled = false,
  actionsDisabledReason,
}: AssignmentRosterProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<FleetAssignment>[]>(() => [
    {
      key: 'driver',
      header: t('fleetOps.assignments.driver', 'Driver'),
      filterValue: (item) => item.driver_id ?? null,
      filterValueLabel: (_value, item) => item.driver_display_name,
      render: (item) => item.driver_display_name,
      visibleOnMobile: true,
    },
    {
      key: 'vehicle',
      header: t('fleetOps.assignments.vehicle', 'Vehicle'),
      filterValue: (item) => item.vehicle_id ?? null,
      filterValueLabel: (_value, item) => item.vehicle_display_name,
      render: (item) => item.vehicle_display_name,
      visibleOnMobile: true,
    },
    {
      key: 'starts_at',
      header: t('fleetOps.assignments.starts', 'Starts'),
      filterValue: (item) => item.starts_at ?? null,
      filterValueLabel: (_value, item) => formatDateTime(item.starts_at),
      render: (item) => formatDateTime(item.starts_at),
    },
    {
      key: 'ends_at',
      header: t('fleetOps.assignments.ends', 'Ends'),
      filterValue: (item) => item.ends_at ?? null,
      filterValueLabel: (_value, item) => item.ends_at
        ? formatDateTime(item.ends_at) : t('fleetOps.assignments.ongoing', 'Ongoing'),
      render: (item) => item.ends_at ? formatDateTime(item.ends_at) : (
        <StatusPill color="bg-emerald-500">
          {t('fleetOps.assignments.ongoing', 'Ongoing')}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions', 'Actions'),
      align: 'right',
      render: (item) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 px-0"
            aria-label={t('fleetOps.assignments.edit', 'Edit assignment for {{name}}', { name: item.driver_display_name })}
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
            className="min-h-11 min-w-11 px-0 text-rose-300"
            aria-label={t('fleetOps.assignments.delete', 'Delete assignment for {{name}}', { name: item.driver_display_name })}
            disabled={actionsDisabled}
            title={actionsDisabledReason}
            onClick={() => onDelete(item)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ], [actionsDisabled, actionsDisabledReason, onDelete, onEdit, t]);

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle>{t('fleetOps.assignments.title', 'Assignment roster')}</PanelTitle>
        <Button
          type="button"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={onAdd}
          disabled={actionsDisabled}
          title={actionsDisabledReason}
        >
          {t('fleetOps.assignments.add', 'Add assignment')}
        </Button>
      </div>
      {loading ? <Skeleton lines={5} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.assignments.resource', 'Assignments')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          message={t('fleetOps.assignments.empty', 'No driver assignments are scheduled.')}
          action={actionsDisabled
            ? undefined
            : { label: t('fleetOps.assignments.add', 'Add assignment'), onClick: onAdd }}
        />
      ) : (
        <DataTable
          tableId="fleet-ops:assignments"
          columns={columns}
          data={items}
          enableValueFilters={enableValueFilters}
          keyExtractor={(item) => item.id}
          mobileColumns={['driver', 'vehicle', 'actions']}
          pagination
        />
      )}
    </GlassPanel>
  );
}
