// Behavioural contract for the Tesla Orders visual board.
//
// OrdersBoard is a pure presentational grid: it renders one <OrderCard> per
// order and exposes the tiles as an accessible, named list. These tests pin
// the facets that matter — one item per order, the accessible list wrapper,
// the per-card affordances (status badge, VIN, delivery date, upgrade chip),
// the null-safe fallbacks for missing optional fields, and — crucially — that
// a stray null/undefined `orders` prop degrades to an empty board instead of
// throwing on `.map`.
//
// No providers are mounted: react-i18next's useTranslation returns the English
// fallback (second arg) when no provider exists, and test-setup.ts globally
// stubs useSettings / useTimezone that OrderCard reaches transitively via
// useDateFormat. So a bare render() is sufficient — no real network is hit.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { OrdersBoard } from './OrdersBoard';
import type { TeslaOrder } from '@/api/hooks/useUser';

function makeOrder(overrides: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN100000001',
    model: 'Model 3',
    status: 'BOOKED',
    delivery_date: null,
    vin: null,
    referral_code: null,
    is_upgradable: false,
    fetched_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('OrdersBoard', () => {
  it('exposes the tiles as a named list with one list item per order', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-A', model: 'Model 3', status: 'BOOKED' }),
      makeOrder({ id: 2, order_id: 'RN-B', model: 'Model Y', status: 'IN_PRODUCTION' }),
      makeOrder({ id: 3, order_id: 'RN-C', model: 'Model S', status: 'DELIVERED' }),
    ];

    render(<OrdersBoard orders={orders} />);

    // Accessible list wrapper with a discoverable name.
    const list = screen.getByRole('list', { name: /orders board/i });
    expect(list).toBeInTheDocument();

    // Exactly one list item per order — no more, no fewer.
    const listItems = within(list).getAllByRole('listitem');
    expect(listItems).toHaveLength(3);

    // Each order's model + id is rendered.
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('Model S')).toBeInTheDocument();
    expect(screen.getByText('RN-A')).toBeInTheDocument();
    expect(screen.getByText('RN-C')).toBeInTheDocument();
  });

  it('renders the status, VIN, delivery date and upgrade affordances of a rich order', () => {
    render(
      <OrdersBoard
        orders={[
          makeOrder({
            id: 7,
            order_id: 'RN-RICH',
            model: 'Model X',
            status: 'READY_FOR_DELIVERY',
            vin: '5YJXCAE20LF000123',
            delivery_date: '2025-06-15T00:00:00Z',
            is_upgradable: true,
          }),
        ]}
      />,
    );

    // Raw SNAKE_CASE status is title-cased for display.
    expect(screen.getByText('Ready For Delivery')).toBeInTheDocument();
    // VIN is shown verbatim (not the "Not assigned" placeholder).
    expect(screen.getByText('5YJXCAE20LF000123')).toBeInTheDocument();
    expect(screen.queryByText(/not assigned/i)).not.toBeInTheDocument();
    // Delivery date is formatted (en-US / UTC via the test stubs) — carries the year.
    expect(screen.getByText(/2025/)).toBeInTheDocument();
    // Upgradable orders surface the upgrade chip.
    expect(screen.getByText(/upgrade available/i)).toBeInTheDocument();
  });

  it('falls back to placeholders for missing optional fields', () => {
    render(
      <OrdersBoard
        orders={[
          makeOrder({
            id: 9,
            order_id: 'RN-BARE',
            model: '',
            status: 'BOOKED',
            vin: null,
            delivery_date: null,
            is_upgradable: false,
          }),
        ]}
      />,
    );

    // Missing VIN → explicit "Not assigned" affordance.
    expect(screen.getByText(/not assigned/i)).toBeInTheDocument();
    // Empty model + null delivery both collapse to the em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // No upgrade chip when the order is not upgradable.
    expect(screen.queryByText(/upgrade available/i)).not.toBeInTheDocument();
  });

  it('renders an empty but valid list when given an empty array', () => {
    render(<OrdersBoard orders={[]} />);

    const list = screen.getByRole('list', { name: /orders board/i });
    expect(list).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('is null-safe: undefined or null orders degrade to an empty board without throwing', () => {
    // Callers are typed to pass an array, but a runtime null/undefined must not
    // crash on `.map` — the whole board would otherwise take down the page.
    expect(() =>
      render(<OrdersBoard orders={undefined} />),
    ).not.toThrow();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    cleanup();

    expect(() => render(<OrdersBoard orders={null} />)).not.toThrow();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('keys on order_id, falling back to the numeric id, without duplicate-key warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // One order has a blank order_id, forcing the `|| order.id` key fallback;
    // both must still render as distinct list items.
    render(
      <OrdersBoard
        orders={[
          makeOrder({ id: 42, order_id: '', model: 'Model 3' }),
          makeOrder({ id: 43, order_id: 'RN-REAL', model: 'Model Y' }),
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();

    const dupKeyWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes('same key'),
    );
    expect(dupKeyWarning).toBe(false);

    errorSpy.mockRestore();
  });
});
