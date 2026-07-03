/**
 * Tesla Orders — visual board.
 *
 * The hero content of the page: an auto-fit responsive grid of `<OrderCard>`
 * tiles that fills the available width (more monitor width = more columns) and
 * collapses to a single column on phones. The page owns the loading / empty /
 * error affordance and passes an already-normalised, non-empty `orders` array.
 */
import type { TeslaOrder } from '@/api/hooks/useUser';
import { OrderCard } from './OrderCard';

interface OrdersBoardProps {
  orders: TeslaOrder[];
}

export function OrdersBoard({ orders }: OrdersBoardProps) {
  return (
    <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
      {orders.map((order) => (
        <OrderCard key={order.order_id || order.id} order={order} />
      ))}
    </div>
  );
}
