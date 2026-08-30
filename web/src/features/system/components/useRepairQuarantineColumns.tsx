import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepairQuarantine } from '@/api/hooks/useDataRepair';
import { Badge, Button, Text, type Column } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

export function useRepairQuarantineColumns(
  canWrite: boolean,
  writeBlockReason: string | undefined,
  onRestore: (quarantine: RepairQuarantine) => void,
): Column<RepairQuarantine>[] {
  const { t } = useTranslation();

  return useMemo<Column<RepairQuarantine>[]>(() => [
    {
      key: 'session',
      header: t('dataRepair.quarantine.columns.session', 'Session'),
      visibleOnMobile: true,
      render: (item) => (
        <div className="space-y-1">
          <Text as="span" size="sm" weight="semibold">
            {t('dataRepair.cases.sessionReference', '{{kind}} #{{id}}', {
              kind: item.kind === 'drive'
                ? t('dataRepair.kind.drive', 'Drive')
                : t('dataRepair.kind.charging', 'Charging'),
              id: item.session_id,
            })}
          </Text>
          <Text as="div" variant="caption">
            {t('dataRepair.cases.vehicleNumber', 'Vehicle #{{id}}', { id: item.vehicle_id })}
          </Text>
          <Badge
            variant={item.restored_at ? 'success' : 'warning'}
            dot
            className="md:hidden"
          >
            {item.restored_at
              ? t('dataRepair.quarantine.restored', 'Restored')
              : t('dataRepair.quarantine.held', 'Held safely')}
          </Badge>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('dataRepair.quarantine.columns.status', 'Status'),
      visibleOnMobile: true,
      render: (item) => (
        <Badge variant={item.restored_at ? 'success' : 'warning'} dot>
          {item.restored_at
            ? t('dataRepair.quarantine.restored', 'Restored')
            : t('dataRepair.quarantine.held', 'Held safely')}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: t('dataRepair.quarantine.columns.reason', 'Reason'),
      render: (item) => <Text as="span" size="sm" className="block max-w-xs">{item.reason}</Text>,
    },
    {
      key: 'quarantined_at',
      header: t('dataRepair.quarantine.columns.quarantinedAt', 'Quarantined'),
      render: (item) => <Text as="span" size="sm">{formatDateTime(item.quarantined_at)}</Text>,
    },
    {
      key: 'actor',
      header: t('dataRepair.quarantine.columns.operator', 'Operator'),
      render: (item) => <Text as="span" size="sm">{item.quarantined_by}</Text>,
    },
    {
      key: 'actions',
      header: t('dataRepair.quarantine.columns.actions', 'Actions'),
      visibleOnMobile: true,
      render: (item) => item.restored_at ? (
        <Text as="span" variant="caption">{formatDateTime(item.restored_at)}</Text>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onRestore(item)}
          disabled={!canWrite}
          title={!canWrite ? writeBlockReason : undefined}
        >
          {t('dataRepair.cases.restoreAction', 'Restore')}
        </Button>
      ),
    },
  ], [canWrite, onRestore, t, writeBlockReason]);
}
