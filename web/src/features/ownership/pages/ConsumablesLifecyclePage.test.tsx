/**
 * ConsumablesLifecyclePage — confirm-gated part deletion.
 *
 * Removing a part is destructive (service history goes with it), so the row
 * Remove button must open a danger confirm dialog naming the part instead of
 * firing the mutation directly. Only the data hooks, vehicle selection, and
 * i18n are mocked; the table, buttons, and confirm dialog render for real.
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
    useConsumableItems: vi.fn(),
    useConsumablesReport: vi.fn(),
    useCreateConsumable: vi.fn(),
    useCreateConsumableEvent: vi.fn(),
    useDeleteConsumable: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useConsumableItems,
  useConsumablesReport,
  useCreateConsumable,
  useCreateConsumableEvent,
  useDeleteConsumable,
} from '@/api/hooks/useOwnership';
import ConsumablesLifecyclePage from './ConsumablesLifecyclePage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { ConsumableItem, ConsumableLifecycle, ConsumablesReport } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockItems = useConsumableItems as unknown as ReturnType<typeof vi.fn>;
const mockReport = useConsumablesReport as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateConsumable as unknown as ReturnType<typeof vi.fn>;
const mockEvent = useCreateConsumableEvent as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteConsumable as unknown as ReturnType<typeof vi.fn>;

function makeItem(overrides: Partial<ConsumableItem> = {}): ConsumableItem {
  return {
    id: 1,
    vehicle_id: 7,
    category: 'cabin_filter',
    label: 'Cabin Filter',
    position: 'front',
    installed_at: '2026-01-01T00:00:00Z',
    installed_odometer_m: 10000,
    rated_life_m: 40000,
    rated_life_s: 365 * 86400,
    cost_minor: 2500,
    currency: 'USD',
    retired_at: null,
    notes: '',
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

function makeLifecycle(overrides: Partial<ConsumableLifecycle> = {}): ConsumableLifecycle {
  return {
    item: makeItem({ label: 'Projected Filter' }),
    events: [],
    distance_used_m: 2500,
    duration_used_s: 60 * 86400,
    distance_life_used_pct: 25,
    time_life_used_pct: null,
    stress_multiplier: 1.1,
    stress_factors: [],
    adjusted_life_m: 9000,
    remaining_m: 6500,
    remaining_s: null,
    health_pct: 75,
    projected_replace_at: null,
    binding_limit: 'distance',
    cost_per_m_minor: 0.012,
    replacement_cost_minor: 4321,
    status: 'healthy',
    narrative: 'Projection based on observed driving, not physical wear.',
    ...overrides,
  };
}

function makeReport(lifecycle = makeLifecycle()): ConsumablesReport {
  return {
    vehicle_id: 7,
    as_of: '2026-03-01T00:00:00Z',
    odometer_m: 12500,
    currency: 'USD',
    items: [lifecycle],
    due_soon_count: 0,
    overdue_count: 0,
    next_replace_at: null,
    twelve_month_cost_minor: 5432,
    lifetime_spend_minor: 7654,
    blended_cost_per_m_minor: 0.018,
    fleet_stress_average: 1.1,
    quality: { status: 'sufficient', sample_count: 42, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    evidence: [],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ConsumablesLifecyclePage />
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

/** The Remove button in the table row showing the given part label. */
function removeButton(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr') as HTMLElement;
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
  mockItems.mockReturnValue(
    makeQuery({ items: [makeItem(), makeItem({ id: 2, label: 'Wiper Blades', category: 'wiper' })] }),
  );
  mockReport.mockReturnValue(makeQuery(undefined));
  mockCreate.mockReturnValue(makeMutation());
  mockEvent.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('ConsumablesLifecyclePage — confirm-gated delete', () => {
  it('uses both page briefs while retaining the specialist part card, wear basis and actual zero counts', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    expectOperationalBand('Fleet wear posture', ['due', 'overdue', 'next', 'twelve', 'lifetime', 'stress']);
    expectOperationalBand('Wear economics', ['blended', 'odometer', 'parts']);
    expect(summaryMetric('Fleet wear posture', 'due')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Fleet wear posture', 'next')).toHaveAttribute('data-value-state', 'missing');
    expect(summaryMetric('Fleet wear posture', 'stress')).toHaveTextContent('×');
    expect(summaryMetric('Fleet wear posture', 'stress')).toHaveTextContent('1.00 is the reference profile');
    expect(summaryMetric('Wear economics', 'blended')).toHaveTextContent('per 1 000 metres driven');
    expect(card('Part-by-part projection')).toHaveTextContent('Part wear cost');
    expect(card('Part-by-part projection').querySelector('[data-operational-brief]')).not.toBeInTheDocument();
    fireEvent.click(within(card('Wear economics')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('per 1 000 metres driven');
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('keeps registered part costs and log controls independent of an initial projection failure', () => {
    const refetch = vi.fn();
    mockReport.mockReturnValue({ ...makeQuery(undefined), error: new Error('projection failed'), refetch });
    renderPage();
    const register = card('Part register');
    expect(within(register).getByText('Cabin Filter')).toBeInTheDocument();
    expect(within(register).getAllByText('$25.00')).toHaveLength(2);
    expect(within(register).getAllByRole('button', { name: 'Log event' })).toHaveLength(2);
    expect(within(register).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(within(card('Wear economics')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockItems).toHaveBeenCalledWith(7);
    expect(mockReport).toHaveBeenCalledWith(7);
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('retains all financial summaries and projections after a failed report refresh and register failure', () => {
    const report = makeReport();
    mockReport.mockReturnValue(makeQuery(report));
    const view = renderPage();
    const refetch = vi.fn();
    mockReport.mockReturnValue({ ...makeQuery(report), error: new Error('refresh failed'), refetch });
    mockItems.mockReturnValue({ ...makeQuery(undefined), error: new Error('register failed') });
    view.rerenderPage();

    const posture = card('Fleet wear posture');
    expect(posture).toHaveTextContent('Next 12 months');
    expect(posture).toHaveTextContent('$54.32');
    expect(posture).toHaveTextContent('Spent to date');
    expect(posture).toHaveTextContent('$76.54');
    expect(posture).toHaveTextContent('Average duty stress');
    const projection = card('Part-by-part projection');
    expect(projection).toHaveTextContent('Projected Filter');
    expect(projection).toHaveTextContent('Projection based on observed driving, not physical wear.');
    expect(projection).toHaveTextContent('Replacement cost');
    expect(projection).toHaveTextContent('$43.21');
    expect(projection).toHaveTextContent('Part wear cost');
    expect(projection).toHaveTextContent('$0.12');
    const economics = card('Wear economics');
    expect(economics).toHaveTextContent('$0.18');
    expect(economics).toHaveTextContent('per 1 000 metres driven');
    expect(within(economics).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(economics).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('exposes every supplied event and its cost, odometer and note without reordering history', () => {
    const lifecycle = makeLifecycle({
      events: Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        item_id: 1,
        kind: 'service',
        occurred_at: `2026-02-${String(8 - index).padStart(2, '0')}T00:00:00Z`,
        odometer_m: index === 7 ? null : index * 1000,
        cost_minor: index === 7 ? 0 : 100 + index,
        note: `History note ${index + 1}`,
        created_at: '2026-03-01T00:00:00Z',
      })),
    });
    mockReport.mockReturnValue(makeQuery(makeReport(lifecycle)));
    renderPage();
    const historyToggle = within(card('Part-by-part projection')).getByRole('button', {
      name: 'Service history (8 events)',
    });
    expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('History note 8')).not.toBeInTheDocument();
    fireEvent.click(historyToggle);
    const history = screen.getByRole('region', { name: 'Service history (8 events)' });
    expect(within(history).getAllByText(/^History note /).map(node => node.textContent))
      .toEqual(Array.from({ length: 8 }, (_, index) => `History note ${index + 1}`));
    expect(within(history).getAllByText('Cost')).toHaveLength(8);
    expect(within(history).getAllByText('Odometer')).toHaveLength(8);
    const last = within(history).getByText('History note 8').closest('dl');
    expect(last).toHaveTextContent('$0.00');
    expect(last).toHaveTextContent('—');
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('renders unknown wear price as unknown, but a supplied zero price as zero', () => {
    mockReport.mockReturnValue(makeQuery(makeReport(makeLifecycle({
      cost_per_m_minor: null, replacement_cost_minor: 0, events: null,
    }))));
    renderPage();
    const projection = card('Part-by-part projection');
    const wear = within(projection).getByText('Part wear cost').parentElement;
    const replacement = within(projection).getByText('Replacement cost').parentElement;
    expect(wear).toHaveTextContent('—');
    expect(wear).not.toHaveTextContent('$0.00');
    expect(replacement).toHaveTextContent('$0.00');
    expect(within(projection).queryByRole('button', { name: /Service history/ })).not.toBeInTheDocument();
  });

  it('keeps a pending event note editable when its register refresh fails', () => {
    const register = { items: [makeItem()] };
    mockItems.mockReturnValue(makeQuery(register));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Log event' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Inspection draft' } });
    mockItems.mockReturnValue({ ...makeQuery(register), error: new Error('refresh failed') });
    view.rerenderPage();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Inspection draft');
    expect(within(card('Part register')).getByText('Cabin Filter')).toBeInTheDocument();
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('opens a danger confirm naming the part instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Cabin Filter'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this part?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Cabin Filter');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Wiper Blades'));
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

    fireEvent.click(removeButton('Cabin Filter'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Wiper Blades')).toBeDisabled();
    expect(removeButton('Cabin Filter')).not.toBeDisabled();
  });
});
