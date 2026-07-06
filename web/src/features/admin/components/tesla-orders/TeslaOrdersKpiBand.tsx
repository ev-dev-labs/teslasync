/**
 * Tesla Orders — KPI band.
 *
 * Full-width responsive metric grid summarising the account's orders: total
 * count plus a lifecycle breakdown (delivered / in-progress / ready), the
 * number of upgradable orders, and the soonest upcoming delivery date. Always
 * renders — values collapse to `0` / `—` when there are no orders so the band
 * never disappears (design-language §8).
 */
import { useTranslation } from 'react-i18next';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  Truck,
  Sparkles,
  CalendarClock,
} from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { OrderStats } from './teslaOrderStats';

interface TeslaOrdersKpiBandProps {
  stats: OrderStats;
}

export function TeslaOrdersKpiBand({ stats }: TeslaOrdersKpiBandProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6">
      <MetricCard
        label={t('admin.teslaOrders.kpi.total', 'Total Orders')}
        value={stats.total ?? 0}
        icon={<ShoppingCart className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('admin.teslaOrders.kpi.delivered', 'Delivered')}
        value={stats.delivered ?? 0}
        icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('admin.teslaOrders.kpi.inProgress', 'In Progress')}
        value={stats.inProgress ?? 0}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        color="amber"
        subtitle={t('admin.teslaOrders.kpi.inProgressHint', 'Booked or building')}
      />
      <MetricCard
        label={t('admin.teslaOrders.kpi.ready', 'Ready · Transit')}
        value={stats.ready ?? 0}
        icon={<Truck className="h-5 w-5" aria-hidden="true" />}
        color="blue"
        subtitle={t('admin.teslaOrders.kpi.readyHint', 'Awaiting handover')}
      />
      <MetricCard
        label={t('admin.teslaOrders.kpi.upgradable', 'Upgradable')}
        value={stats.upgradable ?? 0}
        icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('admin.teslaOrders.kpi.nextDelivery', 'Next Delivery')}
        value={stats.nextDelivery ? formatDate(stats.nextDelivery) : '—'}
        icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
        subtitle={t('admin.teslaOrders.kpi.nextDeliveryHint', 'Soonest upcoming')}
      />
    </div>
  );
}
