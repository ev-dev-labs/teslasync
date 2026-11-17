import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SubscriptionsWidget from './SubscriptionsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const { vehiclesMock, subscriptionsMock, refetchSubscriptions, refetchVehicles } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  subscriptionsMock: vi.fn(),
  refetchSubscriptions: vi.fn(),
  refetchVehicles: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleSubscriptions: (...args: unknown[]) => subscriptionsMock(...args),
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const text = typeof fallback === 'string' ? fallback : key;
        return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateShort: (value: unknown) => value == null ? '—' : `date:${String(value)}`,
    formatTime: (value: unknown) => String(value),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (value: number, decimals = 2) => `$${value.toFixed(decimals)}`,
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const PREMIUM_EXPIRY = '2099-12-31T00:00:00.000Z';
const NEXT_EXPIRY = '2099-11-30T00:00:00.000Z';
const PAST_EXPIRY = '2001-01-01T00:00:00.000Z';
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };

function subscriptionData(): Record<string, unknown> {
  return {
    premium_connectivity: true,
    premium_connectivity_expiry_date: PREMIUM_EXPIRY,
    premium_connectivity_monthly_price: 9.99,
    premium_connectivity_billing_period: 'month',
    premium_connectivity_renewal: 'auto',
    full_self_driving: true,
    full_self_driving_expiry_date: PAST_EXPIRY,
    full_self_driving_price: 199,
    full_self_driving_billing_period: 'month',
    enhanced_autopilot: 'included',
    enhanced_autopilot_renewal_type: 'Lifetime entitlement',
    subscriptions: [{
      name: 'Annual service',
      status: 'active',
      expiry_date: NEXT_EXPIRY,
      price: 120,
      billing_period: 'year',
    }],
  };
}

function queryResult(data: Record<string, unknown> | null = subscriptionData()) {
  return {
    data: { data, fetched_at: new Date().toISOString() },
    error: null as Error | null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchSubscriptions,
  };
}

function widget(packId: string, size: WidgetSize = FULL, vehicleId?: number) {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={
          <PackBoundary requestedPackId={packId}>
            <SubscriptionsWidget size={size} vehicleId={vehicleId} />
          </PackBoundary>
        } />
        <Route path="/vehicle-management" element={<p>Vehicle management reached</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function expectPresentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(
    container.querySelector(`[data-widget-family="list"][data-widget-appearance="${appearance}"]`),
  ).not.toBeNull());
}

function expectSubscriptionList() {
  expect(screen.getByText('Premium Connectivity')).toBeVisible();
  expect(screen.getByText('Full Self-Driving')).toBeVisible();
  expect(screen.getByText('Enhanced Autopilot')).toBeVisible();
  expect(screen.getByText('Annual service')).toBeVisible();
  expect(screen.getAllByText('Active')).toHaveLength(3);
  expect(screen.getByText('Expired')).toBeVisible();
  expect(screen.getByText(`date:${PREMIUM_EXPIRY}`)).toBeVisible();
  expect(screen.getByText(`date:${PAST_EXPIRY}`)).toBeVisible();
  expect(screen.getByText(`date:${NEXT_EXPIRY}`)).toBeVisible();
  expect(screen.getByText('Lifetime entitlement')).toBeVisible();
  expect(screen.getByText('$9.99')).toBeVisible();
  expect(screen.getByText('$199.00')).toBeVisible();
  expect(screen.getByText('$120.00')).toBeVisible();
  expect(screen.getAllByText('/mo')).toHaveLength(2);
  expect(screen.getByText('/year')).toBeVisible();
  expect(screen.getByText('$9.99 / month')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/vehicle-management');
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({
    data: [{ id: 7 }],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchVehicles,
  });
  subscriptionsMock.mockReturnValue(queryResult());
});

describe.each(Object.entries(PACK_APPEARANCES))('Subscriptions %s (%s)', (packId, appearance) => {
  it('renders the real active headline and complete list with prices, renewal evidence and management action', async () => {
    const { container } = render(widget(packId, FULL, 42));
    await expectPresentation(container, appearance);

    expect(screen.getByRole('heading', { name: 'Subscriptions', level: 3 })).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('active')).toBeVisible();
    expectSubscriptionList();
    expect(container.querySelector('[data-widget-family="list"] svg.lucide-credit-card')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('CONNECTED')).not.toBeInTheDocument();
    expect(subscriptionsMock).toHaveBeenCalledOnce();
    expect(subscriptionsMock).toHaveBeenCalledWith('42');
    expect(vehiclesMock).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetchSubscriptions).toHaveBeenCalledOnce();
    expect(refetchVehicles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Manage' }));
    expect(screen.getByText('Vehicle management reached')).toBeVisible();
  });

  it('preserves the compact active count and earliest actual expiry without adding a full list', async () => {
    const { container } = render(widget(packId, COMPACT));
    await expectPresentation(container, appearance);

    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('active')).toBeVisible();
    expect(screen.getByText(`date:${NEXT_EXPIRY}`)).toBeVisible();
    expect(screen.queryByText(`date:${PREMIUM_EXPIRY}`)).not.toBeInTheDocument();
    expect(screen.queryByText('Premium Connectivity')).not.toBeInTheDocument();
    expect(screen.queryByText('$9.99 / month')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
    expect(subscriptionsMock).toHaveBeenCalledWith('7');
  });

  it('distinguishes authoritatively empty subscriptions from a missing vendor payload', async () => {
    subscriptionsMock.mockReturnValue(queryResult({}));
    const view = render(widget(packId));
    await expectPresentation(view.container, appearance);
    expect(screen.getByText('No subscriptions')).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();

    subscriptionsMock.mockReturnValue(queryResult(null));
    view.rerender(widget(packId));
    expect(view.container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(screen.getByText('This widget has no qualifying data yet.')).toBeVisible();
    expect(screen.queryByText('No subscriptions')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('does not turn a configured or undocumented entitlement into an active count or a renewal date', async () => {
    subscriptionsMock.mockReturnValue(queryResult({
      premium_connectivity: { configured: true },
      subscriptions: [{ name: 'Undocumented service' }],
    }));
    const { container } = render(widget(packId));
    await expectPresentation(container, appearance);
    expect(screen.getByText('Premium Connectivity')).toBeVisible();
    expect(screen.getByText('Undocumented service')).toBeVisible();
    expect(screen.getAllByText('Unknown')).toHaveLength(3);
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/^date:/)).not.toBeInTheDocument();
    expect(screen.getByText('active')).toBeVisible();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
  });
});

it('preserves the Classic list across every actual pack selection and restores it unchanged', async () => {
  const view = render(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(view.container.querySelector('.widget-big-number')).toBeNull();
  expectSubscriptionList();

  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(widget(packId));
    await expectPresentation(view.container, appearance);
    expectSubscriptionList();
  }

  view.rerender(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(view.container.querySelector('.widget-big-number')).toBeNull();
  expectSubscriptionList();
});

it('keeps the original compact Classic body as the recovery for an unknown pack', () => {
  const { container } = render(widget('unknown-pack', COMPACT));
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('3')).toBeVisible();
  expect(screen.getByText(`date:${NEXT_EXPIRY}`)).toBeVisible();
  expect(screen.queryByText('Premium Connectivity')).not.toBeInTheDocument();
});

it.each(Object.entries(PACK_APPEARANCES))('%s only displays an actual renewal date, keeps a zero price, and summarizes real inactive subscriptions', async (packId, appearance) => {
  subscriptionsMock.mockReturnValue(queryResult({
    subscriptions: [
      { name: 'Free service', status: 'active', price: 0, billing_period: 'month' },
      { name: 'Invalid expiry', status: 'expired', expiry_date: 'not-a-date' },
    ],
  }));
  const view = render(widget(packId));
  await expectPresentation(view.container, appearance);
  expect(screen.getByText('$0.00')).toBeVisible();
  expect(screen.getByText('$0.00 / month')).toBeVisible();
  expect(screen.queryByText(/^date:/)).not.toBeInTheDocument();
  expect(screen.getByText('1')).toBeVisible();

  subscriptionsMock.mockReturnValue(queryResult({
    subscriptions: [{ name: 'Expired service', status: 'expired', expiry_date: PAST_EXPIRY }],
  }));
  view.rerender(widget(packId));
  expect(screen.getByText('0')).toBeVisible();
  expect(screen.getByText('0 active')).toBeVisible();
  expect(screen.getByText('Expired')).toBeVisible();
});

it.each(Object.entries(PACK_APPEARANCES))('%s retains the selected vehicle, source warning and complete list after a refresh failure', async (packId, appearance) => {
  subscriptionsMock.mockReturnValue({
    ...queryResult(),
    isError: true,
    isStale: true,
    error: new Error('Subscription refresh failed'),
  });
  const { container } = render(widget(packId, FULL, 19));
  await expectPresentation(container, appearance);
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
  expectSubscriptionList();
  expect(subscriptionsMock).toHaveBeenCalledWith('19');
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(refetchSubscriptions).toHaveBeenCalledOnce();
});

it.each(Object.entries(PACK_APPEARANCES))('%s retains the list and blocks repeated refresh while a request is in flight', async (packId, appearance) => {
  subscriptionsMock.mockReturnValue({ ...queryResult(), isFetching: true });
  const { container } = render(widget(packId));
  await expectPresentation(container, appearance);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expectSubscriptionList();
  const refresh = screen.getByRole('button', { name: /^Refresh/i });
  expect(refresh).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(refresh);
  expect(refetchSubscriptions).not.toHaveBeenCalled();
});

it.each(Object.keys(PACK_APPEARANCES))('%s keeps the source shell visible during loading and exposes retry instead of an empty success on fatal failure', async (packId) => {
  subscriptionsMock.mockReturnValue({
    ...queryResult(), data: undefined, dataUpdatedAt: 0, isLoading: true, isFetching: true,
  });
  const view = render(widget(packId));
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Subscriptions', level: 3 })).toBeVisible();
  expect(screen.queryByText('No subscriptions')).not.toBeInTheDocument();
  expect(screen.queryByText('3')).not.toBeInTheDocument();

  subscriptionsMock.mockReturnValue({
    ...queryResult(), data: undefined, dataUpdatedAt: 0, isError: true, error: new Error('Subscriptions unavailable'),
  });
  view.rerender(widget(packId));
  const error = await screen.findByRole('alert');
  expect(within(error).getByText("Can't reach server")).toBeVisible();
  expect(screen.queryByText('No subscriptions')).not.toBeInTheDocument();
  fireEvent.click(within(error).getByRole('button', { name: /retry|try again/i }));
  expect(refetchSubscriptions).toHaveBeenCalledOnce();
});

it.each(Object.keys(PACK_APPEARANCES))('%s retries vehicle discovery rather than a disabled subscription request when the vehicle source fails', (packId) => {
  vehiclesMock.mockReturnValue({
    data: undefined,
    isError: true,
    error: new Error('Vehicles unavailable'),
    dataUpdatedAt: 0,
    refetch: refetchVehicles,
  });
  subscriptionsMock.mockReturnValue({ ...queryResult(), data: undefined, dataUpdatedAt: 0 });
  render(widget(packId));
  expect(subscriptionsMock).toHaveBeenCalledWith(undefined);
  fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(refetchVehicles).toHaveBeenCalledOnce();
  expect(refetchSubscriptions).not.toHaveBeenCalled();
});
