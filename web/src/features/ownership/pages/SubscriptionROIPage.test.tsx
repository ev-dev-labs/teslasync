/**
 * SubscriptionROIPage — subscription lifecycle, display and evidence contracts.
 *
 * Removing a subscription is destructive (ROI history goes with it), so the
 * row Remove button must open a danger confirm dialog naming the
 * subscription instead of firing the mutation directly. Only the data hooks,
 * vehicle selection, and i18n are mocked; the table, buttons, and confirm
 * dialog render for real. Scoped settings/timezone spies exercise saved date
 * preferences without changing the UTC business-date wire contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const translatedLabels = vi.hoisted(() => new Map<string, string>());

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
    if (translatedLabels.has(key)) return translatedLabels.get(key)!;
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
import { neonColorMap, typography } from '@/lib/tokens';
import { getGlobalPrecision, setGlobalPrecision } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import * as settingsHook from '@/hooks/useSettings';
import * as timezoneHook from '@/lib/timezone';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockROI = useSubscriptionROI as unknown as ReturnType<typeof vi.fn>;
const mockSubs = useSubscriptions as unknown as ReturnType<typeof vi.fn>;
const mockCreate = vi.mocked(useCreateSubscription, { partial: true });
const mockRemove = vi.mocked(useDeleteSubscription, { partial: true });

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
  translatedLabels.clear();
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

afterEach(() => {
  vi.restoreAllMocks();
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
    if (!row) throw new Error('Missing verdict row');
    const originalCells = within(row).getAllByRole('cell').slice(0, 10);
    expect(originalCells.map((cell) => cell.textContent).join('').match(/—/g)).toHaveLength(7);
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

  it('links the editor disclosure and retains the original vehicle draft through selection changes', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    const toggle = screen.getByRole('button', { name: 'Add subscription' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const editor = screen.getByRole('form', { name: 'Add subscription' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', editor.id);
    expect(editor).toHaveTextContent('Vehicle 7');
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Name required' }), {
      target: { value: 'Original scope draft' },
    });

    mockSelected.mockReturnValue({ vehicleId: 8, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    view.rerenderPage();
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('Original scope draft');
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Add subscription' }));
    expect(mutate).not.toHaveBeenCalled();

    mockSelected.mockReturnValue({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    view.rerenderPage();
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeEnabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Add subscription' }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 7, name: 'Original scope draft', kind: 'subscription',
      billing_period: 'monthly', price_minor: 0, currency: 'USD',
      usage_metric: 'driving_distance', benchmark_minor_per_unit: 0, ended_at: null,
    }), expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('keeps every verdict field reachable in the mobile quick view with measured utilization and reasoning', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(0, 0, 375, 100));
    mockROI.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    const verdict = card('Per-subscription verdict');
    expect(verdict.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(within(verdict).getByText('Measured Connectivity')).toBeInTheDocument();
    fireEvent.click(within(verdict).getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog', { name: 'Measured Connectivity' });
    for (const label of [
      'Subscription', 'Verdict', 'Monthly cost', 'Spent to date', 'Measured usage',
      'Realised value', 'Net', 'ROI', 'Break-even usage', 'Reasoning',
    ]) {
      expect(within(dialog).getByText(label, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent('Recurring subscription');
    expect(dialog).toHaveTextContent('Monthly');
    expect(dialog).toHaveTextContent('80');
    expect(dialog).toHaveTextContent('$12.34');
    expect(dialog).toHaveTextContent('$24.68');
    expect(dialog).toHaveTextContent('60 active days');
    expect(dialog).toHaveTextContent(/42(?:\.0+)? sessions/);
    expect(dialog).toHaveTextContent(/21(?:\.0+)? \/ month/);
    expect(dialog).toHaveTextContent('$50.00');
    expect(dialog).toHaveTextContent('$25.32');
    expect(dialog).toHaveTextContent('+102.6');
    expect(dialog).toHaveTextContent(/10(?:\.0+)? sessions/);
    expect(dialog).toHaveTextContent('210');
    expect(dialog).toHaveTextContent('Measured usage exceeds the stored benchmark.');
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('keeps register currency, term, benchmark and confirmed removal reachable in mobile details', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(0, 0, 375, 100));
    mockSubs.mockReturnValue(makeQuery({ items: [makeSubscription({
      kind: 'one_time', billing_period: 'once', currency: 'JPY', price_minor: 1000,
      benchmark_minor_per_unit: 3.25, ended_at: '2026-03-01T00:00:00Z',
    })] }));
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    const register = card('Subscription register');
    expect(register.querySelector('[data-mobile-table]')).not.toBeNull();
    fireEvent.click(within(register).getByRole('button', { name: 'Quick view' }));
    const detail = screen.getByRole('dialog', { name: 'Premium Connectivity' });
    for (const label of ['Subscription', 'Price', 'Value metric', 'Benchmark rate', 'Active', 'Actions']) {
      expect(within(detail).getByText(label, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(detail).toHaveTextContent('One-time purchase');
    expect(detail).toHaveTextContent('One-time');
    expect(detail).toHaveTextContent('¥1,000');
    expect(detail).toHaveTextContent('Connectivity time');
    expect(detail).toHaveTextContent('3.25 JPY minor / s');
    expect(detail).not.toHaveTextContent('ongoing');
    fireEvent.click(within(detail).getByRole('button', { name: 'Remove' }));
    const confirmation = screen.getByRole('dialog', { name: 'Delete this subscription?' });
    expect(confirmation).toHaveTextContent('Premium Connectivity');
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(1));
  });

  it.each([
    { case: 'positive', roi: 25, net: 2500, tone: neonColorMap.green.text },
    { case: 'negative', roi: -25, net: -2500, tone: neonColorMap.red.text },
    { case: 'measured zero', roi: 0, net: 0, tone: typography.color.primary },
  ])('uses restrained financial roles for $case without changing the signed source', ({ roi, net, tone }) => {
    mockROI.mockReturnValue(makeQuery(makeReport([makeROI({ roi_pct: roi, net_value_minor: net })])));
    renderPage();
    const row = within(card('Per-subscription verdict')).getByText('Measured Connectivity').closest('tr');
    if (!row) throw new Error('Missing verdict row');
    const cells = within(row).getAllByRole('cell');
    expect(cells[6].querySelector('span')).toHaveClass(tone);
    expect(cells[7].querySelector('span')).toHaveClass(tone);
    expect(cells[7]).toHaveTextContent(roi > 0 ? '+25' : roi < 0 ? '-25' : '0');
  });

  it('converts confirmed SI distance only for display while leaving source quantities unchanged', () => {
    const measured = makeROI({
      usage_unit: 'm', usage_quantity: 2500, usage_per_month: 1250,
      break_even_usage_per_month: 1000,
    });
    mockROI.mockReturnValue(makeQuery(makeReport([measured])));
    renderPage();
    const row = within(card('Per-subscription verdict')).getByText('Measured Connectivity').closest('tr');
    expect(row).toHaveTextContent(/2\.5(?:0)? km/);
    expect(row).toHaveTextContent(/1\.25 km \/ month/);
    expect(row).toHaveTextContent(/1(?:\.0+)? km/);
    expect(measured.usage_quantity).toBe(2500);
    expect(measured.usage_per_month).toBe(1250);
    expect(measured.break_even_usage_per_month).toBe(1000);
    expect(measured.usage_unit).toBe('m');
  });

  it('preserves a cancelled draft until a deliberate new draft binds the selected vehicle', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name required' }), { target: { value: 'Retained draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    mockSelected.mockReturnValue({ vehicleId: 8, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    view.rerenderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('Retained draft');
    expect(screen.getByRole('form', { name: 'Add subscription' })).toHaveTextContent('Vehicle 7');
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start new draft' }));
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('');
    expect(screen.getByRole('form', { name: 'Add subscription' })).toHaveTextContent('Vehicle 8');
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('retires a successfully saved draft so a subsequent draft can bind another vehicle', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name required' }), { target: { value: 'Saved draft' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add subscription' }));
    const callbacks = mutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => callbacks.onSuccess());
    expect(screen.queryByRole('form', { name: 'Add subscription' })).not.toBeInTheDocument();
    mockSelected.mockReturnValue({ vehicleId: 8, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    view.rerenderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    expect(screen.getByRole('form', { name: 'Add subscription' })).toHaveTextContent('Vehicle 8');
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeEnabled();
  });

  it('keeps a blank required price unknown and accepts an explicitly entered zero', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    const editor = screen.getByRole('form', { name: 'Add subscription' });
    const price = within(editor).getByRole('spinbutton', { name: 'Price per period required' });
    fireEvent.change(price, { target: { value: '' } });
    expect(price).toHaveValue(null);
    expect(editor).toHaveTextContent('Display equivalent: —');
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeDisabled();
    fireEvent.submit(editor);
    expect(mockCreate().mutate).not.toHaveBeenCalled();
    fireEvent.change(price, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save subscription' })).toBeEnabled();
    fireEvent.submit(editor);
    expect(mockCreate().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ price_minor: 0 }), expect.any(Object),
    );
  });

  it('does not erase edits made after the submitted draft while its save settles', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    const name = screen.getByRole('textbox', { name: 'Name required' });
    fireEvent.change(name, { target: { value: 'Submitted name' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add subscription' }));
    fireEvent.change(name, { target: { value: 'Retained later edit' } });
    const callbacks = mutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => callbacks.onSuccess());
    expect(screen.getByRole('textbox', { name: 'Name required' })).toHaveValue('Retained later edit');
    expect(screen.getByRole('form', { name: 'Add subscription' })).toHaveTextContent('Vehicle 7');
  });

  it.each([
    { metric: 'driving_distance', rate: 0.001, unit: 'm' },
    { metric: 'supercharging_energy', rate: 0.1, unit: 'Wh' },
    { metric: 'connectivity_time', rate: 0.000001, unit: 's' },
    { metric: 'charging_sessions', rate: 0, unit: 'session' },
    { metric: 'drive_count', rate: 3.25, unit: 'drive' },
  ] as const)('discloses the authoritative $metric denominator without rounding $rate minor to zero', ({ metric, rate, unit }) => {
    const subscription = makeSubscription({ usage_metric: metric, benchmark_minor_per_unit: rate });
    mockSubs.mockReturnValue(makeQuery({ items: [subscription] }));
    renderPage();
    expect(card('Subscription register')).toHaveTextContent(`${rate} USD minor / ${unit}`);
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    const metricSelect = screen.getByRole('combobox', { name: 'Usage metric' });
    fireEvent.change(metricSelect, { target: { value: metric } });
    expect(screen.getByRole('form', { name: 'Add subscription' })).toHaveTextContent(`USD minor / ${unit} (stored unit; not a display-unit rate)`);
    expect(subscription.benchmark_minor_per_unit).toBe(rate);
  });

  it('retains raw ROI in chart and accessible table while formatting known verdicts and metric labels', () => {
    const precision = getGlobalPrecision();
    setGlobalPrecision(2);
    translatedLabels.set('ownership.subscription.metric.connectivity_time', 'Verbindungszeit');
    translatedLabels.set('ownership.verdict.too_early', 'Zu früh');
    const item = makeROI({ roi_pct: 0.04, verdict: 'too_early' });
    mockROI.mockReturnValue(makeQuery(makeReport([item])));
    try {
      renderPage();
      expect(card('Return by subscription')).toHaveTextContent('+0.04%');
      expect(card('Return by subscription')).toHaveTextContent('Zu früh');
      expect(card('Per-subscription verdict')).toHaveTextContent('+0.04%');
      expect(card('Subscription register')).toHaveTextContent('Verbindungszeit');
      fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
      expect(screen.getByRole('option', { name: 'Verbindungszeit' })).toBeInTheDocument();
      expect(item.roi_pct).toBe(0.04);
    } finally {
      act(() => setGlobalPrecision(precision));
    }
  });

  it('preserves UTC business dates and explicitly discloses their midnight basis', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
    const editor = screen.getByRole('form', { name: 'Add subscription' });
    expect(editor).toHaveTextContent('Business dates are saved at midnight UTC; displayed instants use your saved timezone.');
    fireEvent.change(within(editor).getByLabelText(/^Started\b/), { target: { value: '2026-01-01' } });
    fireEvent.change(within(editor).getByLabelText('Ended'), { target: { value: '2026-03-01' } });
    fireEvent.submit(editor);
    expect(mockCreate().mutate).toHaveBeenCalledWith(expect.objectContaining({
      started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-03-01T00:00:00.000Z',
    }), expect.any(Object));
  });

  it('presents row-specific quality, population, coverage, bounds and reasons in desktop and mobile details', () => {
    const quality = {
      status: 'limited' as const, sample_count: 2, coverage_pct: 20,
      window_start: '2026-02-01T00:00:00Z', window_end: '2026-02-03T00:00:00Z',
      reasons: ['Only two observed drives support this subscription.'],
    };
    mockROI.mockReturnValue(makeQuery(makeReport([makeROI({ quality })])));
    const view = renderPage();
    const row = within(card('Per-subscription verdict')).getByText('Measured Connectivity').closest('tr');
    expect(row).toHaveTextContent('Limited evidence');
    expect(row).toHaveTextContent('Samples2');
    expect(row).toHaveTextContent('Coverage20');
    expect(row).toHaveTextContent('Observation window');
    expect(row).toHaveTextContent(formatDateTime(quality.window_start, { locale: 'en-US', tz: 'UTC' }));
    expect(row).toHaveTextContent(formatDateTime(quality.window_end, { locale: 'en-US', tz: 'UTC' }));
    expect(row).toHaveTextContent(quality.reasons[0]);
    view.unmount();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 375, 100));
    renderPage();
    fireEvent.click(within(card('Per-subscription verdict')).getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog', { name: 'Measured Connectivity' });
    expect(within(dialog).getByText('Data quality', { selector: 'dt' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Limited evidence');
    expect(dialog).toHaveTextContent('Samples2');
    expect(dialog).toHaveTextContent('Coverage20');
    expect(dialog).toHaveTextContent(formatDateTime(quality.window_start, { locale: 'en-US', tz: 'UTC' }));
    expect(dialog).toHaveTextContent(formatDateTime(quality.window_end, { locale: 'en-US', tz: 'UTC' }));
    expect(dialog).toHaveTextContent(quality.reasons[0]);
  });

  it('uses saved locale and timezone for register and row-quality instants without rewriting UTC dates', () => {
    const defaults = settingsHook.useSettings();
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...defaults, locale: 'de-DE',
      settings: { ...defaults.settings, locale: 'de-DE', tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
    });
    const timezone = vi.spyOn(timezoneHook, 'useTimezone').mockReturnValue('America/Los_Angeles');
    const subscription = makeSubscription({ ended_at: '2026-03-01T00:00:00Z' });
    const quality = {
      ...makeROI().quality, window_start: subscription.started_at, window_end: subscription.ended_at,
    };
    mockSubs.mockReturnValue(makeQuery({ items: [subscription] }));
    mockROI.mockReturnValue(makeQuery(makeReport([makeROI({ quality })])));
    const view = renderPage();
    const expected = formatDateTime(subscription.started_at, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    const expectedEnd = formatDateTime(subscription.ended_at, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    expect(card('Subscription register')).toHaveTextContent(expected);
    expect(card('Subscription register')).toHaveTextContent(expectedEnd);
    expect(card('Per-subscription verdict')).toHaveTextContent(expected);
    expect(card('Per-subscription verdict')).toHaveTextContent(expectedEnd);
    timezone.mockReturnValue('UTC');
    view.rerenderPage();
    const utc = formatDateTime(subscription.started_at, { locale: 'de-DE', tz: 'UTC' });
    const utcEnd = formatDateTime(subscription.ended_at, { locale: 'de-DE', tz: 'UTC' });
    expect(card('Subscription register')).toHaveTextContent(utc);
    expect(card('Subscription register')).toHaveTextContent(utcEnd);
    expect(card('Per-subscription verdict')).toHaveTextContent(utc);
    expect(card('Per-subscription verdict')).toHaveTextContent(utcEnd);
    expect(subscription.started_at).toBe('2026-01-01T00:00:00Z');
    expect(subscription.ended_at).toBe('2026-03-01T00:00:00Z');
  });
});
