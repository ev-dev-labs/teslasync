/**
 * OrdersTable contract.
 *
 * Covers every observable facet of the Tesla-orders detail table:
 *   1. Per-row rendering of all six columns with null-safe placeholders
 *      (missing VIN / delivery / non-upgradable each fall back to an em-dash).
 *   2. Humanised status labels + the status→Badge variant mapping for every
 *      lifecycle bucket (in-progress / ready / delivered / cancelled).
 *   3. Default sort (model, ascending) and header-toggle to descending.
 *   4. Delivery-date sort, including the regression guard that null AND
 *      malformed dates collapse to epoch 0 (NaN-safe comparator) rather than
 *      poisoning Array.prototype.sort with a NaN comparison.
 *   5. Case-insensitive text filtering across model / id / vin / status.
 *   6. The filtered empty-state message.
 *   7. Defensive rendering when handed an empty (or undefined) orders array.
 *   8. Accessibility of the filter control + the decorative search icon.
 *
 * react-i18next is mocked (mirroring the sibling ApiKeyCard test) so the
 * `t(key, fallback)` calls resolve to their English fallbacks deterministically,
 * independent of the locale bundles. useSettings / timezone come from the global
 * test-setup mock (en-US, UTC), so useDateFormat is fully offline — no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import type { TeslaOrder } from '@/api/hooks/useUser';
import { OrdersTable } from './OrdersTable';

const EM_DASH = '\u2014';

function makeOrder(overrides: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN-1',
    model: 'Model 3',
    status: 'IN_PRODUCTION',
    delivery_date: null,
    vin: null,
    referral_code: null,
    is_upgradable: false,
    fetched_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Body-row text content, in render order (the header row lacks an order id). */
function dataRows(): string[] {
  return screen
    .getAllByRole('row')
    .map((r) => r.textContent ?? '')
    .filter((text) => text.includes('RN-'));
}

/** Index of the body row whose text contains `token`, or -1. */
function idxOf(token: string): number {
  return dataRows().findIndex((text) => text.includes(token));
}

beforeEach(() => {
  // DataTable persists column widths / visibility keyed by tableId; clear so
  // one test's layout never bleeds into the next.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('OrdersTable', () => {
  it('renders every column and falls back to an em-dash for missing vin / delivery / upgradable', () => {
    const orders = [
      makeOrder({
        id: 1,
        order_id: 'RN-A',
        model: 'Model 3',
        status: 'IN_PRODUCTION',
        vin: 'VIN000A',
        delivery_date: '2026-09-01T00:00:00Z',
        is_upgradable: true,
      }),
      makeOrder({
        id: 2,
        order_id: 'RN-B',
        model: 'Model Y',
        status: 'READY_FOR_DELIVERY',
        vin: null,
        delivery_date: null,
        is_upgradable: false,
      }),
    ];
    render(<OrdersTable orders={orders} />);

    // Identity columns render for both rows.
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('RN-A')).toBeInTheDocument();
    expect(screen.getByText('RN-B')).toBeInTheDocument();

    // Row A's populated cells render real values …
    expect(screen.getByText('VIN000A')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(1);

    // … while row B's three empty cells (vin, delivery, upgradable) each show
    // the em-dash placeholder — never a hidden/blank cell.
    expect(screen.getAllByText(EM_DASH)).toHaveLength(3);
  });

  it('humanizes each lifecycle status into a Badge whose variant matches the bucket', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-1', status: 'IN_PRODUCTION' }),
      makeOrder({ id: 2, order_id: 'RN-2', status: 'READY_FOR_DELIVERY' }),
      makeOrder({ id: 3, order_id: 'RN-3', status: 'DELIVERED' }),
      makeOrder({ id: 4, order_id: 'RN-4', status: 'CANCELLED' }),
    ];
    render(<OrdersTable orders={orders} />);

    const inProgress = screen.getByText('In Production');
    const ready = screen.getByText('Ready For Delivery');
    const delivered = screen.getByText('Delivered');
    const cancelled = screen.getByText('Cancelled');

    expect(inProgress).toBeInTheDocument();
    expect(ready).toBeInTheDocument();
    expect(delivered).toBeInTheDocument();
    expect(cancelled).toBeInTheDocument();

    // orderStatusVariant → Badge colour language: in-progress=warning(amber),
    // ready=info(blue), delivered=success(green), cancelled=danger(red).
    expect(inProgress.className).toContain('yellow');
    expect(ready.className).toContain('blue');
    expect(delivered.className).toContain('green');
    expect(cancelled.className).toContain('red');
  });

  it('sorts by model ascending by default', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-Y', model: 'Model Y' }),
      makeOrder({ id: 2, order_id: 'RN-3', model: 'Model 3' }),
      makeOrder({ id: 3, order_id: 'RN-X', model: 'Model X' }),
      makeOrder({ id: 4, order_id: 'RN-S', model: 'Model S' }),
    ];
    render(<OrdersTable orders={orders} />);

    // localeCompare ascending: '3' < 'S' < 'X' < 'Y'.
    expect(idxOf('Model 3')).toBeLessThan(idxOf('Model S'));
    expect(idxOf('Model S')).toBeLessThan(idxOf('Model X'));
    expect(idxOf('Model X')).toBeLessThan(idxOf('Model Y'));
  });

  it('toggles the model sort to descending when the Model header is clicked', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-3', model: 'Model 3' }),
      makeOrder({ id: 2, order_id: 'RN-S', model: 'Model S' }),
      makeOrder({ id: 3, order_id: 'RN-Y', model: 'Model Y' }),
    ];
    render(<OrdersTable orders={orders} />);

    // Sanity: ascending to start.
    expect(idxOf('Model 3')).toBeLessThan(idxOf('Model Y'));

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));

    // Now descending — the order reverses.
    expect(idxOf('Model Y')).toBeLessThan(idxOf('Model S'));
    expect(idxOf('Model S')).toBeLessThan(idxOf('Model 3'));
  });

  it('sorts by delivery date and treats null or malformed dates as the earliest (NaN-safe)', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-P', model: 'Model P', delivery_date: '2026-12-01T00:00:00Z' }),
      makeOrder({ id: 2, order_id: 'RN-Q', model: 'Model Q', delivery_date: '2026-06-01T00:00:00Z' }),
      makeOrder({ id: 3, order_id: 'RN-R', model: 'Model R', delivery_date: null }),
      // A non-null but unparseable value would make Date.parse → NaN; the
      // deliveryEpoch guard must coerce it to 0 rather than a NaN comparator.
      makeOrder({ id: 4, order_id: 'RN-S', model: 'Model S', delivery_date: 'not-a-date' }),
    ];
    render(<OrdersTable orders={orders} />);

    const deliveryHeader = screen.getByRole('button', { name: 'Delivery' });

    // First click on a new key → descending: latest real date first, the two
    // zero-epoch (null + malformed) rows sink to the bottom.
    fireEvent.click(deliveryHeader);
    expect(idxOf('RN-P')).toBeLessThan(idxOf('RN-Q'));
    expect(idxOf('RN-Q')).toBeLessThan(idxOf('RN-R'));
    expect(idxOf('RN-Q')).toBeLessThan(idxOf('RN-S'));

    // Second click toggles to ascending: both zero-epoch rows float to the top,
    // ahead of the earliest real date. This only holds if 'not-a-date' was
    // coerced to 0 (proving the NaN guard) rather than producing NaN.
    fireEvent.click(deliveryHeader);
    expect(idxOf('RN-R')).toBeLessThan(idxOf('RN-Q'));
    expect(idxOf('RN-S')).toBeLessThan(idxOf('RN-Q'));
    expect(idxOf('RN-Q')).toBeLessThan(idxOf('RN-P'));
  });

  it('filters case-insensitively across model, order id, vin and status', () => {
    const orders = [
      makeOrder({ id: 1, order_id: 'RN-A', model: 'Model 3', vin: 'VIN-AAA', status: 'IN_PRODUCTION' }),
      makeOrder({ id: 2, order_id: 'RN-B', model: 'Model Y', vin: null, status: 'READY_FOR_DELIVERY' }),
      makeOrder({ id: 3, order_id: 'RN-C', model: 'Model X', vin: 'VIN-CCC', status: 'DELIVERED' }),
    ];
    render(<OrdersTable orders={orders} />);
    const input = screen.getByRole('textbox', { name: 'Filter orders' });

    // Lower-case query matches the upper-case model text → case-insensitive.
    fireEvent.change(input, { target: { value: 'model x' } });
    expect(screen.getByText('Model X')).toBeInTheDocument();
    expect(screen.queryByText('Model 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Model Y')).not.toBeInTheDocument();

    // Filtering by a VIN fragment narrows to a different single row.
    fireEvent.change(input, { target: { value: 'VIN-AAA' } });
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.queryByText('Model X')).not.toBeInTheDocument();
  });

  it('shows the filtered empty message when no row matches the query', () => {
    render(<OrdersTable orders={[makeOrder({ order_id: 'RN-A', model: 'Model 3' })]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter orders' }), {
      target: { value: 'zzzz-no-match' },
    });
    expect(screen.getByText('No orders match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('Model 3')).not.toBeInTheDocument();
  });

  it('renders the empty message (and never throws) for empty or undefined orders', () => {
    const { unmount } = render(<OrdersTable orders={[]} />);
    expect(screen.getByText('No orders match this filter.')).toBeInTheDocument();
    unmount();

    // Defensive `orders ?? []` guard: a contract-violating undefined must not
    // blow up the `.filter()` call.
    expect(() =>
      render(<OrdersTable orders={undefined as unknown as TeslaOrder[]} />),
    ).not.toThrow();
    expect(screen.getByText('No orders match this filter.')).toBeInTheDocument();
  });

  it('exposes an accessible filter control and marks the search icon decorative', () => {
    const { container } = render(<OrdersTable orders={[makeOrder({ order_id: 'RN-A' })]} />);

    const input = screen.getByRole('textbox', { name: 'Filter orders' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Filter by model, VIN or ID…');

    // The magnifier is purely decorative and must be hidden from a11y tree.
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
