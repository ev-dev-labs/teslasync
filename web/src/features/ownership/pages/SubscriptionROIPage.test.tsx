/**
 * SubscriptionROIPage — confirm-gated subscription deletion.
 *
 * Removing a subscription is destructive (ROI history goes with it), so the
 * row Remove button must open a danger confirm dialog naming the
 * subscription instead of firing the mutation directly. Only the data hooks,
 * vehicle selection, and i18n are mocked; the table, buttons, and confirm
 * dialog render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useSubscriptionROI: vi.fn(),
    useSubscriptions: vi.fn(),
    useCreateSubscription: vi.fn(),
    useDeleteSubscription: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useSubscriptionROI,
  useSubscriptions,
  useCreateSubscription,
  useDeleteSubscription,
} from '@/api/hooks/useOwnership';
import SubscriptionROIPage from './SubscriptionROIPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { Subscription, SubscriptionROI, SubscriptionROIReport } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockROI = useSubscriptionROI as unknown as ReturnType<typeof vi.fn>;
const mockSubs = useSubscriptions as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateSubscription as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteSubscription as unknown as ReturnType<typeof vi.fn>;

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    vehicle_id: 7,
    name: 'Premium Connectivity',
    kind: 'subscription',
    billing_period: 'monthly',
    price_minor: 999,
    currency: 'USD',
    usage_metric: 'connectivity_time',
    benchmark_minor_per_unit: 1,
    started_at: '2026-01-01T00:00:00Z',
    ended_at: null,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function makeROI(overrides: Partial<SubscriptionROI> = {}): SubscriptionROI {
  return {
    subscription: makeSubscription({ name: 'Measured Connectivity' }),
    active_days: 60,
    spend_to_date_minor: 2468,
    monthly_cost_minor: 1234,
    usage_quantity: 42,
    usage_unit: 'sessions',
    usage_per_month: 21,
    realised_value_minor: 5000,
    net_value_minor: 2532,
    roi_pct: 102.6,
    break_even_usage_per_month: 10,
    utilisation_pct: 210,
    verdict: 'keep',
    confidence: 0.8,
    narrative: 'Measured usage exceeds the stored benchmark.',
    quality: { status: 'sufficient', sample_count: 42, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    ...overrides,
  };
}

function makeReport(items: SubscriptionROI[] = [makeROI()]): SubscriptionROIReport {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    currency: 'USD',
    items,
    total_monthly_cost_minor: 1234,
    total_spend_to_date_minor: 2468,
    total_realised_value_minor: 5000,
    portfolio_roi_pct: 102.6,
    cancel_candidate_saving_minor: 0,
    quality: makeROI().quality,
    evidence: [],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SubscriptionROIPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(content());
  return { ...view, rerenderPage: () => view.rerender(content()) };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function metric(title: string, label: string): HTMLElement {
  const element = within(card(title)).getByText(label).parentElement;
  if (!element) throw new Error(`Missing metric: ${label}`);
  return element;
}

/** The Remove button in the table row showing the given subscription name. */
function removeButton(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockROI.mockReturnValue(makeQuery(undefined));
  mockSubs.mockReturnValue(
    makeQuery({
      items: [makeSubscription(), makeSubscription({ id: 2, name: 'FSD Subscription' })],
    }),
  );
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('SubscriptionROIPage — confirm-gated delete', () => {
  it('keeps the real portfolio brief with source minor-unit money, signed ROI and monthly cancellation basis', () => {
    mockROI.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    expectOperationalBand('Portfolio economics', ['monthly', 'spend', 'value', 'roi', 'saving']);
    expect(summaryMetric('Portfolio economics', 'monthly')).toHaveTextContent('$12.34');
    expect(summaryMetric('Portfolio economics', 'roi')).toHaveTextContent('+102.6');
    expect(summaryMetric('Portfolio economics', 'saving')).toHaveTextContent('$0.00');
    expect(summaryMetric('Portfolio economics', 'saving')).toHaveTextContent('per month, if all cancelled');
    fireEvent.click(within(card('Portfolio economics')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('per month, if all cancelled');
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('isolates initial report failure from the independently loaded subscription costs', () => {
    const refetch = vi.fn();
    mockROI.mockReturnValue({ ...makeQuery(undefined), error: new Error('report failed'), refetch });
    renderPage();

    const register = card('Subscription register');
    expect(within(register).getByText('Premium Connectivity')).toBeInTheDocument();
    expect(within(register).getAllByText('$9.99')).toHaveLength(2);
    expect(within(register).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(within(card('Portfolio economics')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockROI).toHaveBeenCalledWith(7, 180);
    expect(mockSubs).toHaveBeenCalledWith(7);
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('retains the full portfolio and verdict detail through a failed refresh and failed register', () => {
    const report = makeReport();
    mockROI.mockReturnValue(makeQuery(report));
    const view = renderPage();
    const refetch = vi.fn();
    mockROI.mockReturnValue({ ...makeQuery(report), error: new Error('refresh failed'), refetch });
    mockSubs.mockReturnValue({ ...makeQuery(undefined), error: new Error('register failed') });
    view.rerenderPage();

    expect(metric('Portfolio economics', 'Monthly commitment')).toHaveTextContent('$12.34');
    expect(metric('Portfolio economics', 'Spent to date')).toHaveTextContent('$24.68');
    expect(metric('Portfolio economics', 'Realised value')).toHaveTextContent('$50.00');
    expect(metric('Portfolio economics', 'Portfolio ROI')).toHaveTextContent('+102.6');
    expect(metric('Portfolio economics', 'Cancel-candidate saving')).toHaveTextContent('$0.00');
    const verdict = card('Per-subscription verdict');
    const row = within(verdict).getByText('Measured Connectivity').closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('$25.32');
    expect(row).toHaveTextContent('60 active days');
    expect(row).toHaveTextContent(/42(?:\.0+)? sessions/);
    expect(row).toHaveTextContent(/21(?:\.0+)? \/ month/);
    expect(row).toHaveTextContent(/10(?:\.0+)? sessions/);
    expect(row).toHaveTextContent('210');
    expect(row).toHaveTextContent('Measured usage exceeds the stored benchmark.');
    expect(within(verdict).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(verdict).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('does not present an unobserved value as free usage or a computed return', () => {
    mockROI.mockReturnValue(makeQuery({
      ...makeReport([makeROI({
        usage_quantity: null, usage_per_month: null, realised_value_minor: null,
        net_value_minor: null, roi_pct: null, break_even_usage_per_month: null,
        utilisation_pct: null, verdict: 'unknown', narrative: 'Usage has not been observed.',
      })]),
      total_realised_value_minor: null,
      portfolio_roi_pct: null,
    }));
    renderPage();

    expect(metric('Portfolio economics', 'Realised value')).toHaveTextContent('—');
    expect(metric('Portfolio economics', 'Realised value')).not.toHaveTextContent('$0.00');
    expect(metric('Portfolio economics', 'Portfolio ROI')).toHaveTextContent('—');
    const row = within(card('Per-subscription verdict')).getByText('Measured Connectivity').closest('tr');
    expect(row).toHaveTextContent('Usage has not been observed.');
    expect(row?.textContent?.match(/—/g)).toHaveLength(7);
    expect(screen.getByText('No subscription has enough measured usage to compute a return yet.')).toBeInTheDocument();
  });

  it('keeps observed zero usage and zero return distinct from unknown', () => {
    mockROI.mockReturnValue(makeQuery({
      ...makeReport([makeROI({
        usage_quantity: 0, usage_per_month: 0, realised_value_minor: 0,
        net_value_minor: 0, roi_pct: 0, utilisation_pct: 0,
      })]),
      total_realised_value_minor: 0,
      portfolio_roi_pct: 0,
    }));
    renderPage();

    expect(metric('Portfolio economics', 'Realised value')).toHaveTextContent('$0.00');
    expect(metric('Portfolio economics', 'Portfolio ROI')).toHaveTextContent('0');
    const row = within(card('Per-subscription verdict')).getByText('Measured Connectivity').closest('tr');
    expect(row).toHaveTextContent(/0(?:\.0+)? sessions/);
    expect(row).toHaveTextContent(/0(?:\.0+)? \/ month/);
    expect(row).toHaveTextContent('$0.00');
    expect(screen.queryByText('No subscription has enough measured usage to compute a return yet.')).not.toBeInTheDocument();
  });

  it('keeps a typed draft reachable when the register initially fails without submitting it', () => {
    mockSubs.mockReturnValue({ ...makeQuery(undefined), error: new Error('register failed') });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name required' }), { target: { value: 'Draft only' } });
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('Draft only');
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeEnabled();
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('opens a danger confirm naming the subscription instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Premium Connectivity'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this subscription?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Premium Connectivity');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('FSD Subscription'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Premium Connectivity'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('FSD Subscription')).toBeDisabled();
    expect(removeButton('Premium Connectivity')).not.toBeDisabled();
  });
});
