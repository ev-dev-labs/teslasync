import { Icons } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { MetricCard } from '@/components/data-display';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { OrderStats } from '../tesla-orders/teslaOrderStats';

interface OrderSummaryProps {
  stats: OrderStats | null;
  loading: boolean;
}

export function OrderSummary({ stats, loading }: OrderSummaryProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  return (
    <div aria-busy={loading} className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6">
      <MetricCard label={t('admin.teslaOrders.kpi.total', 'Total orders')}
        value={stats?.total ?? '—'} wrapLabel icon={<Icons.shoppingCart className="h-5 w-5" aria-hidden />} />
      <MetricCard label={t('admin.teslaOrders.kpi.delivered', 'Delivered')}
        value={stats?.delivered ?? '—'} wrapLabel color="green" icon={<Icons.successFilled className="h-5 w-5" aria-hidden />} />
      <MetricCard label={t('admin.teslaOrders.kpi.inProgress', 'In progress')}
        value={stats?.inProgress ?? '—'} wrapLabel color="amber" icon={<Icons.clock className="h-5 w-5" aria-hidden />}
        subtitle={t('admin.teslaOrders.kpi.inProgressHint', 'Booked or building')} />
      <MetricCard label={t('admin.teslaOrders.kpi.ready', 'Ready · transit')}
        value={stats?.ready ?? '—'} wrapLabel color="blue" icon={<Icons.truck className="h-5 w-5" aria-hidden />}
        subtitle={t('admin.teslaOrders.kpi.readyHint', 'Awaiting handover')} />
      <MetricCard label={t('admin.teslaOrders.kpi.upgradable', 'Upgradable')}
        value={stats?.upgradable ?? '—'} wrapLabel color="purple" icon={<Icons.sparkles className="h-5 w-5" aria-hidden />} />
      <MetricCard label={t('admin.teslaOrders.kpi.nextDelivery', 'Next delivery')}
        value={stats?.nextDelivery ? formatDate(stats.nextDelivery) : '—'} wrapLabel
        icon={<Icons.calendarClock className="h-5 w-5" aria-hidden />}
        subtitle={t('admin.teslaOrders.kpi.nextDeliveryHint', 'Soonest upcoming')} />
    </div>
  );
}
