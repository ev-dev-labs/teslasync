import { BatteryCharging, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Button, DataTable, GlassPanel, PanelTitle, StatusPill, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { FleetChargingPolicy } from '@/api/hooks/useFleetOps';

interface ChargingPolicyMatrixProps {
  items: FleetChargingPolicy[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: FleetChargingPolicy) => void;
  onDelete: (item: FleetChargingPolicy) => void;
}

const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function ChargingPolicyMatrix({
  items,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onDelete,
}: ChargingPolicyMatrixProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const windowLabel = (item: FleetChargingPolicy) => item.windows.map((window) => {
    const day = t(`fleetOps.days.${dayKeys[window.day_of_week]}`, dayKeys[window.day_of_week].toUpperCase());
    return `${day} ${window.start_local_time}–${window.end_local_time}`;
  }).join(', ');
  const columns = useMemo<Column<FleetChargingPolicy>[]>(() => [
    {
      key: 'vehicle',
      header: t('fleetOps.policies.vehicle', 'Vehicle'),
      render: (item) => item.vehicle_display_name,
      visibleOnMobile: true,
    },
    {
      key: 'policy',
      header: t('fleetOps.policies.policy', 'Policy'),
      render: (item) => (
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {t('fleetOps.policies.priority', 'Priority')} {item.priority}
          </p>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'target',
      header: t('fleetOps.policies.targetSoc', 'Target SoC'),
      render: (item) => `${item.target_soc_pct}%`,
      align: 'right',
    },
    {
      key: 'power',
      header: t('fleetOps.policies.maxPower', 'Max power'),
      render: (item) => formatPower(item.max_power_w),
      align: 'right',
    },
    {
      key: 'windows',
      header: t('fleetOps.policies.allowedWindows', 'Allowed windows'),
      render: (item) => windowLabel(item) || '—',
    },
    {
      key: 'enabled',
      header: t('fleetOps.policies.state', 'State'),
      render: (item) => (
        <StatusPill color={item.enabled ? 'bg-emerald-500' : 'bg-slate-500'}>
          {item.enabled ? t('fleetOps.policies.enabled', 'Enabled') : t('fleetOps.policies.disabled', 'Disabled')}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions', 'Actions'),
      align: 'right',
      render: (item) => (
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 px-0" aria-label={t('fleetOps.policies.edit', 'Edit {{name}}', { name: item.name })} onClick={() => onEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 px-0 text-rose-300" aria-label={t('fleetOps.policies.delete', 'Delete {{name}}', { name: item.name })} onClick={() => onDelete(item)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ], [formatPower, onDelete, onEdit, t]);

  return (
    <GlassPanel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle>{t('fleetOps.policies.title', 'Charging policy matrix')}</PanelTitle>
        <Button type="button" size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
          {t('fleetOps.policies.add', 'Add policy')}
        </Button>
      </div>
      {loading ? <Skeleton lines={6} /> : error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('fleetOps.policies.resource', 'Charging policies')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BatteryCharging className="h-8 w-8" />}
          message={t('fleetOps.policies.empty', 'No charging policies are configured.')}
          action={{ label: t('fleetOps.policies.add', 'Add policy'), onClick: onAdd }}
        />
      ) : (
        <div className="mt-4">
          <DataTable
            tableId="fleet-ops:charging-policies"
            columns={columns}
            data={items}
            keyExtractor={(item) => item.id}
            mobileColumns={['vehicle', 'policy', 'actions']}
            pagination
          />
        </div>
      )}
    </GlassPanel>
  );
}
