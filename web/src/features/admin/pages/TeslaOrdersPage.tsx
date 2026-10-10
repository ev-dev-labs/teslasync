/**
 * TeslaOrdersPage — first-class page for the Tesla "Active Orders" surface
 * (vehicle orders + delivery tracking pulled from the owner's Tesla account).
 *
 * Modern-UI gold-standard layout: a full-width KPI band, a status-breakdown +
 * delivery-outlook bento, the visual orders board (hero), and a filterable
 * detail table. Each data section owns its own loading / empty / error state
 * (design-language §8) rather than gating the whole page behind one guard.
 *
 * Data flows through the `@/api/hooks/useUser` TanStack hooks
 * (`GET /tesla/user/orders`, `POST /tesla/user/orders/refresh`).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ShoppingCart, LayoutGrid, ListOrdered } from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTeslaUserOrders, useRefreshTeslaOrders } from '@/api/hooks/useUser';
import { deriveDataState } from '@/api/dataState';
import { OrdersOperationalBrief } from '../components/statstrip-tesla-account-privacy/OrdersOperationalBrief';

import {
  OrderStatusBreakdown,
  DeliveryOutlookPanel,
  OrdersBoard,
  OrdersTable,
  OrdersSectionState,
  computeOrderStats,
  type OrderSectionStatus,
} from '../components/tesla-orders';

export default function TeslaOrdersPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.teslaOrders.pageTitle', 'Tesla orders'));

  const ordersQuery = useTeslaUserOrders();
  const ordersRefresh = useRefreshTeslaOrders();
  const ordersState = deriveDataState(ordersQuery);

  const orders = useMemo(
    () => ordersQuery.data?.orders ?? [],
    [ordersQuery.data],
  );
  const stats = useMemo(() => computeOrderStats(orders), [orders]);
  const fetchedAt = ordersQuery.data?.fetched_at ?? null;

  // Each data section renders its own affordance from this single discriminator
  // rather than gating the whole page behind one `{data && …}`.
  const status: OrderSectionStatus = ordersState.status === 'initial'
    ? 'loading'
    : ordersState.fatalError
      ? 'error'
      : orders.length === 0
        ? 'empty'
        : 'ready';

  const onRetry = () => {
    void ordersQuery.refetch();
  };

  const emptyIcon = <ShoppingCart className="h-10 w-10" aria-hidden="true" />;
  const emptyMessage = fetchedAt
    ? t('admin.teslaOrders.empty.synced', 'No active orders found on this Tesla account.')
    : t(
        'admin.teslaOrders.empty.unsynced',
        'No order data yet. Refresh to fetch the latest orders from Tesla.',
      );
  const emptyAction = {
    label: t('admin.teslaOrders.refresh', 'Refresh'),
    onClick: () => ordersRefresh.mutate(),
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={
          <RefreshCw
            className={cn('h-3.5 w-3.5', ordersRefresh.isPending && 'animate-spin')}
            aria-hidden="true"
          />
        }
        onClick={() => ordersRefresh.mutate()}
        disabled={ordersRefresh.isPending}
        aria-busy={ordersRefresh.isPending || undefined}
        wrapLabel
      >
        {t('admin.teslaOrders.refresh', 'Refresh')}
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('admin.teslaOrders.pageTitle', 'Tesla orders')}
      subtitle={t(
        'admin.teslaOrders.subtitle',
        'Vehicle orders and delivery tracking pulled from your Tesla account.',
      )}
      secondaryActions={actions}
      query={ordersQuery}
      dataSources={[{ id: 'tesla-orders', label: t('admin.teslaOrders.pageTitle', 'Tesla orders'), query: ordersQuery }]}
    >
      {/* 1 — KPI band: full-width responsive metric grid (always visible) */}
      <FadeIn>
        <section aria-label={t('admin.teslaOrders.kpis', 'Order summary')}>
          <OrdersOperationalBrief stats={ordersState.hasData && Array.isArray(ordersQuery.data?.orders) ? stats : null}
            fetchedAt={fetchedAt} loading={ordersState.status === 'initial'}
            sourceStatus={ordersState.status} />
        </section>
      </FadeIn>

      {/* 2 — Bento: status breakdown (hero, spans 2) + delivery outlook */}
      <FadeIn delay={0.1}>
        <SectionErrorBoundary name="tesla-orders-breakdown">
          <section
            aria-label={t('admin.teslaOrders.insights', 'Order insights')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <OrderStatusBreakdown
              stats={stats}
              status={status}
              error={ordersState.fatalError}
              onRetry={onRetry}
              emptyIcon={emptyIcon}
            />
            <DeliveryOutlookPanel
              stats={stats}
              status={status}
              error={ordersState.fatalError}
              onRetry={onRetry}
              fetchedAt={fetchedAt}
              emptyIcon={emptyIcon}
            />
          </section>
        </SectionErrorBoundary>
      </FadeIn>

      {/* 3 — Hero board: auto-fit grid of order cards (full-bleed) */}
      <FadeIn delay={0.2}>
        <SectionErrorBoundary name="tesla-orders-board">
          <LayoutCard title={t('admin.teslaOrders.panels.board', 'Orders')}
            actions={<LayoutGrid className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
            <OrdersSectionState
              status={status}
              error={ordersState.fatalError}
              onRetry={onRetry}
              skeletonHeight={200}
              emptyIcon={emptyIcon}
              emptyTitle={t('admin.teslaOrders.empty.title', 'No orders')}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            >
              <OrdersBoard orders={orders} />
            </OrdersSectionState>
          </LayoutCard>
        </SectionErrorBoundary>
      </FadeIn>

      {/* 4 — Detail band: full-width filterable table */}
      <FadeIn delay={0.3}>
        <SectionErrorBoundary name="tesla-orders-table">
          <LayoutCard title={t('admin.teslaOrders.panels.details', 'Order details')}
            actions={<ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
            <OrdersSectionState
              status={status}
              error={ordersState.fatalError}
              onRetry={onRetry}
              skeletonHeight={320}
              emptyIcon={emptyIcon}
              emptyTitle={t('admin.teslaOrders.empty.title', 'No orders')}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            >
              <OrdersTable orders={orders} />
            </OrdersSectionState>
          </LayoutCard>
        </SectionErrorBoundary>
      </FadeIn>
    </PageLayout>
  );
}
