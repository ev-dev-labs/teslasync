/**
 * Tesla Orders — visual board.
 *
 * The hero content of the page: an auto-fit responsive grid of `<OrderCard>`
 * tiles that fills the available width (more monitor width = more columns) and
 * collapses to a single column on phones. The page owns the loading / empty /
 * error affordance and normally passes an already-normalised, non-empty
 * `orders` array; this component stays a pure, null-safe presentational grid
 * and exposes the tiles as an accessible, named list so screen-reader users can
 * navigate the board and hear its item count.
 */
import { useTranslation } from 'react-i18next';

import type { TeslaOrder } from '@/api/hooks/useUser';
import { OrderCard } from './OrderCard';

interface OrdersBoardProps {
  /**
   * Orders to render. Normalised (non-empty) by the page, but accepted as
   * nullable so a stray `undefined`/`null` degrades to an empty board instead
   * of throwing on `.map`.
   */
  orders: TeslaOrder[] | null | undefined;
}

export function OrdersBoard({ orders }: OrdersBoardProps) {
  const { t } = useTranslation();
  const items = orders ?? [];

  return (
    <ul
      aria-label={t('admin.teslaOrders.board.aria', 'Orders board')}
      className="m-0 grid gap-3 p-0 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]"
    >
      {items.map((order) => (
        <li key={order.order_id || order.id} className="h-full">
          <OrderCard order={order} />
        </li>
      ))}
    </ul>
  );
}
