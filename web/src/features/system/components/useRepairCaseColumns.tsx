import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepairCase, RepairCaseStatus } from '@/api/hooks/useDataRepair';
import { Badge, Button, StatusPill, Text, type Column } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import {
  repairCodeLabel,
  repairStatusLabel,
  REPAIR_STATUS_COLORS,
} from './repairCasePresentation';

export function useRepairCaseColumns(onOpenCase: (id: number) => void): Column<RepairCase>[] {
  const { t } = useTranslation();
  const statusLabels = useMemo<Record<RepairCaseStatus, string>>(() => ({
    open: repairStatusLabel(t, 'open'),
    in_review: repairStatusLabel(t, 'in_review'),
    applied: repairStatusLabel(t, 'applied'),
    dismissed: repairStatusLabel(t, 'dismissed'),
    quarantined: repairStatusLabel(t, 'quarantined'),
    restored: repairStatusLabel(t, 'restored'),
    resolved: repairStatusLabel(t, 'resolved'),
  }), [t]);

  return useMemo<Column<RepairCase>[]>(() => [
    {
      key: 'case',
      header: t('dataRepair.cases.columns.case', 'Case'),
      visibleOnMobile: true,
      render: (item) => (
        <div className="space-y-1">
          <Text as="span" size="sm" weight="semibold">
            {t('dataRepair.cases.caseNumber', 'Case #{{id}}', { id: item.id })}
          </Text>
          <Text as="div" variant="caption">
            {t('dataRepair.cases.sessionReference', '{{kind}} #{{id}}', {
              kind: item.kind === 'drive'
                ? t('dataRepair.kind.drive', 'Drive')
                : t('dataRepair.kind.charging', 'Charging'),
              id: item.session_id,
            })}
          </Text>
          <Text as="div" variant="caption" className="max-w-56 md:hidden">
            {repairCodeLabel(t, item.rule)}
          </Text>
        </div>
      ),
    },
    {
      key: 'rule',
      header: t('dataRepair.cases.columns.finding', 'Finding'),
      visibleOnMobile: true,
      render: (item) => (
        <div className="max-w-xs space-y-1">
          <Text as="span" size="sm">{repairCodeLabel(t, item.rule)}</Text>
          {!item.applicable && item.blocked_reason ? (
            <Text as="div" variant="caption" className="text-amber-700 dark:text-amber-300">
              {repairCodeLabel(t, item.blocked_reason)}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('dataRepair.cases.columns.status', 'Status'),
      render: (item) => (
        <StatusPill color={REPAIR_STATUS_COLORS[item.status]}>
          {statusLabels[item.status]}
        </StatusPill>
      ),
    },
    {
      key: 'confidence',
      header: t('dataRepair.cases.columns.confidence', 'Confidence'),
      render: (item) => (
        <Badge variant={item.confidence === 'high' ? 'success' : 'warning'}>
          {item.confidence === 'high'
            ? t('dataRepair.confidence.high', 'High')
            : t('dataRepair.confidence.medium', 'Medium')}
        </Badge>
      ),
    },
    {
      key: 'assigned_to',
      header: t('dataRepair.cases.columns.owner', 'Owner'),
      render: (item) => (
        <Text as="span" size="sm" color={item.assigned_to ? 'primary' : 'muted'}>
          {item.assigned_to ?? t('dataRepair.cases.unassignedValue', 'Unassigned')}
        </Text>
      ),
    },
    {
      key: 'last_seen_at',
      header: t('dataRepair.cases.columns.lastDetected', 'Last detected'),
      render: (item) => <Text as="span" size="sm">{formatDateTime(item.last_seen_at)}</Text>,
    },
    {
      key: 'actions',
      header: t('dataRepair.cases.columns.actions', 'Actions'),
      visibleOnMobile: true,
      render: (item) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Eye className="h-4 w-4" aria-hidden="true" />}
          onClick={() => onOpenCase(item.id)}
          aria-label={t('dataRepair.cases.reviewCaseLabel', 'Review case {{id}}', { id: item.id })}
        >
          {t('dataRepair.cases.review', 'Review')}
        </Button>
      ),
    },
  ], [onOpenCase, statusLabels, t]);
}
