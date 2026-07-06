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

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTeslaUserOrders, useRefreshTeslaOrders } from '@/api/hooks/useUser';

import {
  TeslaOrdersKpiBand,
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
  usePageTitle(t('admin.teslaOrders.pageTitle', 'Tesla Orders'));

  const ordersQuery = useTeslaUserOrders();
  const ordersRefresh = useRefreshTeslaOrders();

  const orders = useMemo(
    () => ordersQuery.data?.orders ?? [],
    [ordersQuery.data],
  );
  const stats = useMemo(() => computeOrderStats(orders), [orders]);
  const fetchedAt = ordersQuery.data?.fetched_at ?? null;

  // Each data section renders its own affordance from this single discriminator
  // rather than gating the whole page behind one `{data && …}`.
  const status: OrderSectionStatus = ordersQuery.isLoading
    ? 'loading'
    : ordersQuery.isError
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
      >
        {t('admin.teslaOrders.refresh', 'Refresh')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('admin.teslaOrders.pageTitle', 'Tesla Orders')}
      subtitle={t(
        'admin.teslaOrders.subtitle',
        'Vehicle orders and delivery tracking pulled from your Tesla account.',
      )}
      actions={actions}
      query={ordersQuery}
    >
      {/* 1 — KPI band: full-width responsive metric grid (always visible) */}
      <FadeIn>
        <section aria-label={t('admin.teslaOrders.kpis', 'Order summary')}>
          <TeslaOrdersKpiBand stats={stats} />
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
              error={ordersQuery.error}
              onRetry={onRetry}
              emptyIcon={emptyIcon}
            />
            <DeliveryOutlookPanel
              stats={stats}
              status={status}
              error={ordersQuery.error}
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
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.teslaOrders.panels.board', 'Orders')}
            </PanelTitle>
            <OrdersSectionState
              status={status}
              error={ordersQuery.error}
              onRetry={onRetry}
              skeletonHeight={200}
              emptyIcon={emptyIcon}
              emptyTitle={t('admin.teslaOrders.empty.title', 'No orders')}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            >
              <OrdersBoard orders={orders} />
            </OrdersSectionState>
          </GlassPanel>
        </SectionErrorBoundary>
      </FadeIn>

      {/* 4 — Detail band: full-width filterable table */}
      <FadeIn delay={0.3}>
        <SectionErrorBoundary name="tesla-orders-table">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.teslaOrders.panels.details', 'Order Details')}
            </PanelTitle>
            <OrdersSectionState
              status={status}
              error={ordersQuery.error}
              onRetry={onRetry}
              skeletonHeight={320}
              emptyIcon={emptyIcon}
              emptyTitle={t('admin.teslaOrders.empty.title', 'No orders')}
              emptyMessage={emptyMessage}
              emptyAction={emptyAction}
            >
              <OrdersTable orders={orders} />
            </OrdersSectionState>
          </GlassPanel>
        </SectionErrorBoundary>
      </FadeIn>
    </PageContainer>
  );
}
