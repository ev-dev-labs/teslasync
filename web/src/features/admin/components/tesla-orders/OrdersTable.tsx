/**
 * Tesla Orders — detail table.
 *
 * Renders the account's orders as a filterable + sortable detail band. The
 * page owns the loading / error / empty affordances (via `OrdersSectionState`)
 * and passes an already-normalised, non-empty `orders` array; this component
 * only handles the text filter, sort, and per-row rendering.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import {
  DataTable,
  Input,
  Badge,
  Text,
  Caption,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';

import type { TeslaOrder } from '@/api/hooks/useUser';
import {
  orderStatusVariant,
  formatOrderStatus,
  bucketOfStatus,
} from './teslaOrderStats';

interface OrdersTableProps {
  orders: TeslaOrder[];
}

export function OrdersTable({ orders }: OrdersTableProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const [filter, setFilter] = useState('');
  const { sortKey, sortDir, onSort } = useSortToggle('model', 'asc');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.model, o.order_id, o.vin, o.status]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [orders, filter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'model') return (a.model || '').localeCompare(b.model || '') * dir;
      if (sortKey === 'status') {
        return bucketOfStatus(a.status).localeCompare(bucketOfStatus(b.status)) * dir;
      }
      if (sortKey === 'delivery') {
        const at = a.delivery_date ? Date.parse(a.delivery_date) : 0;
        const bt = b.delivery_date ? Date.parse(b.delivery_date) : 0;
        return (at - bt) * dir;
      }
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const columns: Column<TeslaOrder>[] = [
    {
      key: 'model',
      header: t('admin.teslaOrders.cols.model', 'Model'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <Text as="span" weight="medium" color="primary">
          {row.model || '—'}
        </Text>
      ),
    },
    {
      key: 'order_id',
      header: t('admin.teslaOrders.cols.orderId', 'Order ID'),
      render: (row) => (
        <Text as="span" size="xs" color="secondary" mono title={row.order_id}>
          {row.order_id}
        </Text>
      ),
    },
    {
      key: 'vin',
      header: t('admin.teslaOrders.cols.vin', 'VIN'),
      render: (row) =>
        row.vin ? (
          <Text as="span" size="xs" color="secondary" mono title={row.vin}>
            {row.vin}
          </Text>
        ) : (
          <Caption>—</Caption>
        ),
    },
    {
      key: 'status',
      header: t('admin.teslaOrders.cols.status', 'Status'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <Badge variant={orderStatusVariant(row.status)} size="sm">
          {formatOrderStatus(row.status)}
        </Badge>
      ),
    },
    {
      key: 'delivery',
      header: t('admin.teslaOrders.cols.delivery', 'Delivery'),
      sortable: true,
      render: (row) => (
        <Text as="span" size="xs" color="primary" className="tabular-nums">
          {row.delivery_date ? formatDate(row.delivery_date) : '—'}
        </Text>
      ),
    },
    {
      key: 'upgradable',
      header: t('admin.teslaOrders.cols.upgradable', 'Upgradable'),
      align: 'center',
      render: (row) =>
        row.is_upgradable ? (
          <Badge variant="info" size="sm">
            {t('admin.teslaOrders.cols.yes', 'Yes')}
          </Badge>
        ) : (
          <Caption>—</Caption>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('admin.teslaOrders.filterPlaceholder', 'Filter by model, VIN or ID…')}
          className="pl-9"
          aria-label={t('admin.teslaOrders.filterAria', 'Filter orders')}
        />
      </div>

      <DataTable<TeslaOrder>
        tableId="admin:tesla-orders"
        name="tesla-orders"
        columns={columns}
        data={sorted}
        keyExtractor={(row) => row.order_id || row.id}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        emptyMessage={t('admin.teslaOrders.table.filtered', 'No orders match this filter.')}
        pagination={{ defaultPageSize: 25, pageSizeOptions: [10, 25, 50] }}
        mobileColumns={['model', 'status']}
      />
    </div>
  );
}
