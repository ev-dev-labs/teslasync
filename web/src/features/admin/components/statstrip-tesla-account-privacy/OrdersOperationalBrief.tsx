import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { DataStatus } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { OrderStats } from '../tesla-orders/teslaOrderStats';
import { useAccountSnapshotPeriod } from './useAccountSnapshotPeriod';
import { useAccountBriefStatus } from './useAccountBriefStatus';

interface OrdersOperationalBriefProps {
  stats: OrderStats | null;
  fetchedAt: string | null;
  loading: boolean;
  sourceStatus: DataStatus;
}

export function OrdersOperationalBrief({ stats, fetchedAt, loading, sourceStatus }: OrdersOperationalBriefProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const period = useAccountSnapshotPeriod(fetchedAt);
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'orders-total', rawValue: stats?.total,
      label: t('admin.teslaOrders.kpi.total', 'Total orders') },
    { metricId: 'count', occurrenceId: 'orders-delivered', rawValue: stats?.delivered,
      label: t('admin.teslaOrders.kpi.delivered', 'Delivered') },
    { metricId: 'count', occurrenceId: 'orders-in-progress', rawValue: stats?.inProgress,
      label: t('admin.teslaOrders.kpi.inProgress', 'In progress'),
      context: t('admin.teslaOrders.kpi.inProgressHint', 'Booked or building') },
    { metricId: 'count', occurrenceId: 'orders-ready', rawValue: stats?.ready,
      label: t('admin.teslaOrders.kpi.ready', 'Ready · transit'),
      context: t('admin.teslaOrders.kpi.readyHint', 'Awaiting handover') },
    { metricId: 'count', occurrenceId: 'orders-upgradable', rawValue: stats?.upgradable,
      label: t('admin.teslaOrders.kpi.upgradable', 'Upgradable') },
    { metricId: 'text', occurrenceId: 'orders-next-delivery',
      rawValue: stats?.nextDelivery ? formatDate(stats.nextDelivery) : null,
      label: t('admin.teslaOrders.kpi.nextDelivery', 'Next delivery'),
      context: t('admin.teslaOrders.kpi.nextDeliveryHint', 'Soonest upcoming') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const status = useAccountBriefStatus(sourceStatus);
  return <OperationalBrief compact testId="tesla-orders-summary" metrics={briefMetrics}
    eyebrow={t('teslaAccount.brief.eyebrow', 'Tesla account')}
    title={t('admin.teslaOrders.brief.title', 'Order progress')}
    description={t('admin.teslaOrders.brief.description', 'Order progress and the soonest upcoming delivery from your Tesla account.')}
    {...status} loading={loading}
    scope={<Text as="span" variant="caption">{period.label}</Text>}
    provenance={period.kind === 'snapshot' ? period.provenance : undefined} />;
}
