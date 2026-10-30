/**
 * ConsumablesLifecyclePage — confirm-gated part deletion.
 *
 * Removing a part is destructive (service history goes with it), so the row
 * Remove button must open a danger confirm dialog naming the part instead of
 * firing the mutation directly. Only the data hooks, vehicle selection, and
 * i18n are mocked; the table, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const { datePreferences } = vi.hoisted(() => ({
  datePreferences: { locale: 'en-US', tz_display_default: 'utc', timezone_user: '' },
}));

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

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return { ...result, settings: { ...result.settings, ...datePreferences }, locale: datePreferences.locale };
    },
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
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
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

const mobileObservers: { element: Element; callback: ResizeObserverCallback }[] = [];
function useNarrowTables() {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { mobileObservers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
}

function resizeTables(width: number) {
  act(() => mobileObservers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(datePreferences, { locale: 'en-US', tz_display_default: 'utc', timezone_user: '' });
  mobileObservers.length = 0;
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
    expectOperationalBand('Fleet wear posture', ['due', 'overdue', 'twelve', 'lifetime', 'stress']);
    expectOperationalBand('Wear economics', ['blended', 'odometer', 'parts']);
    expect(summaryMetric('Fleet wear posture', 'due')).toHaveAttribute('data-value-state', 'value');
    assertOperationalMetricUnavailable(card('Fleet wear posture'), 'Next replacement');
    expect(summaryMetric('Fleet wear posture', 'stress')).toHaveTextContent('×');
    fireEvent.click(within(card('Fleet wear posture')).getByRole('button', { name: 'Review details' }));
    const postureDialog = screen.getByRole('dialog');
    expect(within(postureDialog).getByRole('group', { name: 'Average duty stress' }))
      .toHaveTextContent('1.00 is the reference profile');
    fireEvent.keyDown(postureDialog, { key: 'Escape' });
    expect(summaryMetric('Wear economics', 'blended')).toHaveTextContent('$0.18');
    expect(card('Part-by-part projection')).toHaveTextContent('Part wear cost');
    expect(card('Part-by-part projection').querySelector('[data-operational-brief]')).not.toBeInTheDocument();
    fireEvent.click(within(card('Wear economics')).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Blended wear cost' }))
      .toHaveTextContent('per 1 000 metres driven');
    expect(dialog).toHaveTextContent('per 1 000 metres driven');
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
    fireEvent.click(within(economics).getByRole('button', { name: 'Review details' }));
    const economicsDialog = screen.getByRole('dialog');
    expect(within(economicsDialog).getByRole('group', { name: 'Blended wear cost' }))
      .toHaveTextContent('per 1 000 metres driven');
    fireEvent.keyDown(economicsDialog, { key: 'Escape' });
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

  it('keeps mobile part actions and every rated-life, cost and identity detail in the existing table pipeline', () => {
    useNarrowTables();
    const item = makeItem({ currency: 'EUR', cost_minor: 4321, notes: 'Raw entry remains unchanged' });
    mockItems.mockReturnValue(makeQuery({ items: [item] }));
    renderPage();
    resizeTables(320);
    const register = card('Part register');
    expect(register.querySelector('[data-grid-variant="embedded"]')).toBeInTheDocument();
    expect(register.querySelector('[data-mobile-table]')).toBeInTheDocument();
    expect(within(register).getByRole('button', { name: 'Log event' })).toBeEnabled();
    expect(within(register).getByRole('button', { name: 'Remove' })).toBeEnabled();
    fireEvent.click(within(register).getByRole('button', { name: 'Quick view' }));
    const details = screen.getByRole('dialog', { name: 'Cabin Filter' });
    expect(details).toHaveTextContent('cabin filter · front');
    expect(details).toHaveTextContent('Installed');
    expect(details).toHaveTextContent('Rated life');
    expect(details).toHaveTextContent(/365(?:[.,]0+)? d/);
    expect(details).toHaveTextContent('€43.21');
    expect(details).toHaveTextContent('in service');
    expect(within(details).getByRole('button', { name: 'Log event' })).toBeEnabled();
    expect(within(details).getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(within(details).getAllByRole('button', { name: 'Close' })).toHaveLength(2);
    const footer = details.querySelector('[data-modal-footer]');
    if (!(footer instanceof HTMLElement)) throw new Error('Missing part-details footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    resizeTables(900);
    expect(register.querySelector('[data-mobile-table]')).not.toBeInTheDocument();
    expect(within(register).getByRole('table', { name: 'ownership-consumables-items' })).toBeInTheDocument();
    expect(item).toMatchObject({ rated_life_m: 40000, rated_life_s: 365 * 86400, cost_minor: 4321, currency: 'EUR' });
    expect(mockEvent().mutate).not.toHaveBeenCalled();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('retains the measured SI reference and full duty-factor explanation on narrow containers', () => {
    useNarrowTables();
    const factor = {
      code: 'distance', label: 'Recorded duty factor', observed_value: 1234,
      baseline_value: 987, si_unit: 'm', multiplier: 1.25, narrative: 'Comparison assumption and coverage limits',
    };
    mockReport.mockReturnValue(makeQuery(makeReport(makeLifecycle({ stress_factors: [factor] }))));
    renderPage();
    resizeTables(375);
    const stress = card('Why your wear rate differs');
    expect(stress.querySelector('[data-grid-variant="embedded"]')).toBeInTheDocument();
    expect(stress).toHaveTextContent('987');
    expect(stress).toHaveTextContent('Reference');
    fireEvent.click(within(stress).getByRole('button', { name: 'Quick view' }));
    const detail = screen.getByRole('dialog');
    expect(detail).toHaveTextContent('Comparison assumption and coverage limits');
    expect(detail).toHaveTextContent('987');
    expect(detail).toHaveTextContent('1,234');
    expect(detail).toHaveTextContent('m');
    expect(detail).toHaveTextContent('×1.25');
    expect(factor.observed_value).toBe(1234);
    expect(factor.baseline_value).toBe(987);
  });

  it('labels and focuses the event target, uses its currency and restores the row trigger on cancel', () => {
    mockItems.mockReturnValue(makeQuery({ items: [makeItem({ currency: 'EUR' })] }));
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    const trigger = screen.getByRole('button', { name: 'Log event' });
    fireEvent.click(trigger);
    const editor = screen.getByRole('form', { name: 'Log event — Cabin Filter' });
    expect(within(editor).getByRole('heading', { name: 'Log event — Cabin Filter' })).toHaveFocus();
    expect(editor).toHaveTextContent('EUR');
    expect(editor).not.toHaveTextContent('USD');
    fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Cost' }), { target: { value: '1234' } });
    expect(editor).toHaveTextContent('€12.34');
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('form', { name: 'Log event — Cabin Filter' })).not.toBeInTheDocument();
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('closes the old vehicle event editor without submitting or clearing its draft on workspace change', () => {
    mockItems.mockReturnValue(makeQuery({ items: [makeItem()] }));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Log event' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Retained inspection draft' } });
    mockSelected.mockReturnValue({ vehicleId: 8 });
    mockItems.mockReturnValue(makeQuery({ items: [makeItem({ id: 3, vehicle_id: 8, label: 'Other vehicle filter' })] }));
    view.rerenderPage();
    expect(screen.queryByRole('form', { name: 'Log event — Cabin Filter' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log event' }));
    expect(screen.getByRole('form', { name: 'Log event — Other vehicle filter' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Retained inspection draft');
    expect(mockEvent().mutate).not.toHaveBeenCalled();
  });

  it('preserves raw SI event payloads and ignores old success callbacks after another target is opened', () => {
    let settle: (() => void) | undefined;
    const mutate = vi.fn((_body: unknown, options: { onSuccess: () => void }) => { settle = options.onSuccess; });
    mockEvent.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    fireEvent.click(within(card('Part register')).getAllByRole('button', { name: 'Log event' })[0]);
    const editor = screen.getByRole('form', { name: 'Log event — Cabin Filter' });
    fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Odometer' }), { target: { value: '123456' } });
    fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Cost' }), { target: { value: '4321' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Note' }), { target: { value: 'SI maintenance event' } });
    fireEvent.submit(editor);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      item_id: 1, kind: 'inspect', occurred_at: expect.any(String),
      odometer_m: 123456, cost_minor: 4321, note: 'SI maintenance event',
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    const row = screen.getByText('Wiper Blades').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Log event' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'New target draft' } });
    act(() => settle?.());
    expect(screen.getByRole('form', { name: 'Log event — Wiper Blades' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('New target draft');
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('submits part entry in metres, seconds and currency minor units without converting the editable draft', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
    const partLabel = screen.getByRole('textbox', { name: 'Part label required' });
    expect(partLabel).toBeRequired();
    fireEvent.change(partLabel, { target: { value: 'Recorded tyre' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Odometer at install' }), { target: { value: '123456' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rated life (distance)' }), { target: { value: '60000' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rated life (days)' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Replacement cost' }), { target: { value: '4321' } });
    const currencyCode = screen.getByRole('textbox', { name: 'ISO currency code required' });
    expect(currencyCode).toBeRequired();
    fireEvent.change(currencyCode, { target: { value: 'EUR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save part' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      vehicle_id: 7, category: 'tire', label: 'Recorded tyre', position: '',
      installed_at: expect.any(String), installed_odometer_m: 123456,
      rated_life_m: 60000, rated_life_s: 2592000, cost_minor: 4321, currency: 'EUR', notes: '',
    });
    expect(screen.getByRole('spinbutton', { name: 'Odometer at install' })).toHaveValue(123456);
    expect(screen.getByRole('spinbutton', { name: 'Rated life (days)' })).toHaveValue(30);
  });

  it('exposes a stable record-part disclosure relationship across editor activations', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Record part' });
    const target = toggle.getAttribute('aria-controls');
    expect(target).toBeTruthy();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Part label required' }).closest('form')).toHaveAttribute('id', target);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-controls', target);
  });

  it.each(['unchanged', 'edited', 'reopened', 'batched reactivation', 'vehicle changed', 'vehicle round trip', 'reopened for another vehicle'] as const)(
    'settles a part-create callback only for its owning editor: %s',
    (scenario) => {
      let settle: (() => void) | undefined;
      const mutate = vi.fn((_body: unknown, options: { onSuccess: () => void }) => { settle = options.onSuccess; });
      mockCreate.mockReturnValue(makeMutation({ mutate }));
      const view = renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Part label required' }), { target: { value: 'Original part' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Keep my raw note' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save part' }));
      expect(mutate).toHaveBeenCalledOnce();
      expect(mutate.mock.calls[0][0]).toMatchObject({ vehicle_id: 7, label: 'Original part', notes: 'Keep my raw note' });

      if (scenario === 'edited') {
        fireEvent.change(screen.getByRole('textbox', { name: 'Part label required' }), { target: { value: 'Later part' } });
      }
      if (scenario === 'reopened') {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
      }
      if (scenario === 'batched reactivation') {
        const toggle = screen.getByRole('button', { name: 'Cancel' });
        act(() => {
          fireEvent.click(toggle);
          fireEvent.click(toggle);
        });
      }
      if (scenario === 'reopened for another vehicle') {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        mockSelected.mockReturnValue({ vehicleId: 8 });
        view.rerenderPage();
        fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
      }
      if (scenario === 'vehicle changed' || scenario === 'vehicle round trip') {
        mockSelected.mockReturnValue({ vehicleId: 8 });
        view.rerenderPage();
        if (scenario === 'vehicle round trip') {
          mockSelected.mockReturnValue({ vehicleId: 7 });
          view.rerenderPage();
        }
      }
      const notes = screen.getByRole('textbox', { name: 'Notes' });
      notes.focus();
      act(() => settle?.());
      if (scenario === 'unchanged') {
        expect(screen.queryByRole('button', { name: 'Save part' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
      } else {
        expect(screen.getByRole('button', { name: 'Save part' })).toBeInTheDocument();
        expect(notes).toHaveFocus();
      }
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Keep my raw note');
      expect(screen.getByRole('textbox', { name: 'Part label required' })).toHaveValue(
        scenario === 'edited' ? 'Later part' : 'Original part',
      );
    },
  );

  it('does not submit a second part while its create mutation is pending', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate, isPending: true }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Record part' }));
    const form = screen.getByRole('textbox', { name: 'Part label required' }).closest('form');
    if (!form) throw new Error('Missing part editor');
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('renders installed, retired, projected and history timestamps with saved locale and timezone on desktop and mobile', () => {
    useNarrowTables();
    Object.assign(datePreferences, { locale: 'de-DE', tz_display_default: 'utc' });
    const instant = '2026-02-02T00:30:00Z';
    const expected = (locale: string, timeZone: string) => new Date(instant).toLocaleString(locale, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
    });
    const item = makeItem({ installed_at: instant, retired_at: instant });
    const lifecycle = makeLifecycle({
      item, projected_replace_at: instant,
      events: [{ id: 1, item_id: 1, kind: 'inspect', occurred_at: instant, odometer_m: null,
        cost_minor: 0, note: 'Raw dated note', created_at: instant }],
    });
    mockItems.mockReturnValue(makeQuery({ items: [item] }));
    mockReport.mockReturnValue(makeQuery({ ...makeReport(lifecycle), next_replace_at: instant }));
    const view = renderPage();
    const assertDates = (date: string) => {
      expect(card('Part register')).toHaveTextContent(date);
      expect(card('Part-by-part projection')).toHaveTextContent(date);
      expect(summaryMetric('Fleet wear posture', 'next')).toHaveTextContent(date);
    };
    assertDates(expected('de-DE', 'UTC'));
    fireEvent.click(screen.getByRole('button', { name: 'Service history (1 events)' }));
    expect(screen.getByRole('region', { name: 'Service history (1 events)' })).toHaveTextContent(expected('de-DE', 'UTC'));
    Object.assign(datePreferences, { locale: 'fr-FR', tz_display_default: 'user', timezone_user: 'America/Los_Angeles' });
    view.rerenderPage();
    assertDates(expected('fr-FR', 'America/Los_Angeles'));
    resizeTables(320);
    assertDates(expected('fr-FR', 'America/Los_Angeles'));
    fireEvent.click(within(card('Part register')).getByRole('button', { name: 'Quick view' }));
    expect(screen.getByRole('dialog', { name: 'Cabin Filter' })).toHaveTextContent(expected('fr-FR', 'America/Los_Angeles'));
    expect(item.installed_at).toBe(instant);
    expect(item.retired_at).toBe(instant);
    expect(lifecycle.projected_replace_at).toBe(instant);
    expect(lifecycle.events?.[0].occurred_at).toBe(instant);
  });

  it('does not remove the previous vehicle part when workspace scope changes during confirmation', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    fireEvent.click(removeButton('Cabin Filter'));
    mockSelected.mockReturnValue({ vehicleId: 8 });
    mockItems.mockReturnValue(makeQuery({ items: [makeItem({ id: 3, vehicle_id: 8 })] }));
    view.rerenderPage();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await act(async () => {});
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the life bar decorative, clamps only its visual width and leaves missing predictions unknown', () => {
    mockReport.mockReturnValue(makeQuery(makeReport(makeLifecycle({
      health_pct: 120, remaining_m: null, remaining_s: null, adjusted_life_m: null,
    }))));
    const view = renderPage();
    const projection = card('Part-by-part projection');
    expect(projection).toHaveTextContent('120');
    const fill = projection.querySelector('[aria-hidden="true"] > [style]');
    expect(fill).toHaveStyle({ width: '100%' });
    expect(fill?.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(within(projection).getByText('Remaining').parentElement).toHaveTextContent('—');
    expect(within(projection).getByText('Duty-adjusted life').parentElement).toHaveTextContent('—');
    mockReport.mockReturnValue(makeQuery(makeReport(makeLifecycle({ health_pct: Number.NaN }))));
    view.rerenderPage();
    expect(projection.querySelector('[aria-hidden="true"] > [style]')).not.toBeInTheDocument();
    expect(within(projection).getByText('Remaining life').parentElement).toHaveTextContent('—');
  });
});
