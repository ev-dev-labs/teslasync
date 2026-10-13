import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { TCOOptimizerRequest, TCOOptimizerResponse } from '@/types/advancedIntelligence';
import TCOOptimizerPage from './TCOOptimizerPage';

const mocks = vi.hoisted(() => {
  const state: {
    vehicleId: number | null;
    error: Error | null;
    isPending: boolean;
    isPaused: boolean;
  } = { vehicleId: 4, error: null, isPending: false, isPaused: false };
  return {
    state,
    mutate: vi.fn<(request: TCOOptimizerRequest, options?: {
      onSuccess?: (result: TCOOptimizerResponse) => void;
    }) => void>(),
  };
});

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRunTCOOptimizer: () => ({ ...mocks.state, mutate: mocks.mutate }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: mocks.state.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { locale: 'en-US' },
    formatDuration: (value: number | null) => value == null ? '—' : `${value} s display`,
    formatDistance: (value: number | null) => value == null ? '—' : `${value} m display`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => value.toFixed(2),
    fmtInt: (value: number) => String(value),
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string) => `display date ${value}`,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      const template = typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions : String(values?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

function payload(overrides: Partial<TCOOptimizerResponse> = {}): TCOOptimizerResponse {
  return {
    vehicle_id: 4,
    horizon_s: 94608000,
    currency: 'USD',
    generated_at: '2026-10-01T12:00:00Z',
    strategies: [{
      name: 'test_supported_mix',
      home_charging_pct: 80,
      public_charging_pct: 20,
      projected_cost_minor: 12345,
      risk_score_pct: 0,
      convenience_score_pct: 75,
      within_budget: true,
      pareto_efficient: true,
      constraints: ['Test-only recorded-cost assumption.', 'Test-only constraint remains visible.'],
    }],
    data_quality: {
      status: 'limited', sample_count: 3, coverage_pct: 0,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-10-01T00:00:00Z',
      reasons: ['Test-only maintenance coverage remains incomplete.'],
    },
    evidence: [{
      source: 'test-recorded-costs',
      summary: 'Test-only supported cost evidence.',
      sample_count: 3,
      observed_at: '2026-10-01T12:00:00Z',
    }],
    limitations: ['Test-only projections are not guarantees.'],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<TCOOptimizerPage />, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  });
}

function run() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate confirmed alternatives' }));
}

function assertSections() {
  expect(screen.getByRole('heading', { name: 'Optimization constraints' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pareto-like alternatives' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
  for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
    expect(screen.getByRole('region', { name })).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.vehicleId = 4;
  mocks.state.error = null;
  mocks.state.isPending = false;
  mocks.state.isPaused = false;
  mocks.mutate.mockImplementation(() => undefined);
});

describe('TCOOptimizerPage', () => {
  it('keeps every panel, SI default, input and unsupported disclosure visible before submission', () => {
    renderPage();
    assertSections();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6);
    expect(screen.getByRole('spinbutton', { name: /Planning horizon/ })).toHaveValue(94608000);
    expect(screen.getByRole('spinbutton', { name: /Annual distance/ })).toHaveValue(20000000);
    expect(screen.getByRole('textbox', { name: /^ISO currency code/ })).toHaveValue('USD');
    expect(screen.getByText('Display equivalent: 94608000 s display')).toBeInTheDocument();
    expect(screen.getByText('Display equivalent: 20000000 m display')).toBeInTheDocument();
    expect(screen.getByText('Submit constraints to generate supported alternatives.')).toBeInTheDocument();
    expect(screen.getByText(/no zero is fabricated/)).toBeInTheDocument();
    expect(screen.getByText(/Purchases, charging changes, or financial guarantees/)).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('submits the exact confirmed SI and minor-unit payload only on explicit activation', () => {
    renderPage();
    run();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate.mock.calls[0][0]).toEqual({
      vehicle_id: 4, horizon_s: 94608000, annual_distance_m: 20000000,
      home_charging_pct: 80, public_charging_pct: 20, risk_tolerance_pct: 35,
      budget_minor: 1800000, currency: 'USD', confirmed: true,
    });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('preserves cleared drafts without turning missing values or the paired share into zero', () => {
    renderPage();
    const home = screen.getByRole('spinbutton', { name: /^Home charging \(%\)/ });
    const publicShare = screen.getByRole('spinbutton', { name: /^Public charging \(%\)/ });
    fireEvent.change(home, { target: { value: '' } });
    expect(home).toHaveValue(null);
    expect(publicShare).toHaveValue(20);
    const horizon = screen.getByRole('spinbutton', { name: /Planning horizon/ });
    fireEvent.change(horizon, { target: { value: '' } });
    expect(horizon).toHaveValue(null);
    expect(screen.getByText('Display equivalent: —')).toBeInTheDocument();
    run();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('complements both charging shares and retains valid zero risk and budget', () => {
    renderPage();
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Home charging \(%\)/ }), { target: { value: '0' } });
    expect(screen.getByRole('spinbutton', { name: /^Public charging \(%\)/ })).toHaveValue(100);
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Public charging \(%\)/ }), { target: { value: '0' } });
    expect(screen.getByRole('spinbutton', { name: /^Home charging \(%\)/ })).toHaveValue(100);
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Risk tolerance \(%\)/ }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Budget \(minor units\)/ }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^ISO currency code/ }), { target: { value: 'jpy' } });
    run();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      home_charging_pct: 100, public_charging_pct: 0,
      risk_tolerance_pct: 0, budget_minor: 0, currency: 'JPY',
    });
  });

  it('enforces server-confirmed horizon, distance and currency boundaries through native validation', () => {
    renderPage();
    const horizon = screen.getByRole('spinbutton', { name: /Planning horizon/ });
    const distance = screen.getByRole('spinbutton', { name: /Annual distance/ });
    expect(horizon).toHaveAttribute('max', '315360000');
    expect(distance).toHaveAttribute('max', '1000000000');
    fireEvent.change(horizon, { target: { value: '315360001' } });
    expect(horizon).toBeInvalid();
    run();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(horizon, { target: { value: '315360000' } });
    fireEvent.change(distance, { target: { value: '1000000001' } });
    expect(distance).toBeInvalid();
    fireEvent.change(distance, { target: { value: '1000000000' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^ISO currency code/ }), { target: { value: 'U1D' } });
    expect(screen.getByRole('textbox', { name: /^ISO currency code/ })).toBeInvalid();
    run();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('explains a missing workspace vehicle without introducing local scope selectors', () => {
    mocks.state.vehicleId = null;
    renderPage();
    assertSections();
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate confirmed alternatives' })).toBeDisabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('keeps all neighboring panels while a pending run is busy and prevents resubmission', () => {
    mocks.state.isPending = true;
    renderPage();
    assertSections();
    const action = screen.getByRole('button', { name: 'Generate confirmed alternatives' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading Pareto-like alternatives' })).toBeInTheDocument();
    expect(action).toHaveClass('min-h-11', 'max-w-full');
    run();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('distinguishes a paused initial request from an empty response or failure', () => {
    mocks.state.isPending = true;
    mocks.state.isPaused = true;
    renderPage();
    assertSections();
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    expect(screen.queryByText('No supported data is available.')).not.toBeInTheDocument();
  });

  it('retains every named strategy row, evidence, assumptions and neutral embedded matrix', () => {
    mocks.mutate.mockImplementation((_request, options) => options?.onSuccess?.(payload()));
    renderPage();
    run();
    assertSections();
    const article = screen.getByRole('article');
    expect(article).toHaveClass('min-w-0', 'rounded-panel', 'bg-[var(--panel-bg)]', 'break-words');
    const table = within(article).getByRole('table', { name: 'test_supported_mix' });
    expect(table.closest('[data-table-variant]')).toHaveAttribute('data-table-variant', 'embedded');
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('$123.45')).toBeInTheDocument();
    expect(within(table).getByText('0.00%')).toBeInTheDocument();
    expect(within(table).getByText('75.00%')).toBeInTheDocument();
    expect(within(table).getByText('80.00% / 20.00%')).toBeInTheDocument();
    expect(within(table).getByText('Within budget')).toBeInTheDocument();
    expect(within(article).getByText('Pareto-efficient')).toBeInTheDocument();
    expect(within(article).getByText(/Test-only recorded-cost assumption/)).toBeInTheDocument();
    expect(screen.getByText(/Test-only supported cost evidence/)).toBeInTheDocument();
    expect(screen.getByText(/Test-only maintenance coverage/)).toBeInTheDocument();
    expect(screen.getByText(/Test-only projections are not guarantees/)).toBeInTheDocument();
    expect(screen.getByText('Last updated: display date 2026-10-01T12:00:00Z')).toBeInTheDocument();
  });

  it('distinguishes null cost, risk and budget from legitimate zero amounts', () => {
    const result = payload();
    result.strategies.push({
      ...result.strategies[0], name: 'test_unknown_mix',
      projected_cost_minor: null, risk_score_pct: null, within_budget: null,
    });
    result.strategies[0].projected_cost_minor = 0;
    mocks.mutate.mockImplementation((_request, options) => options?.onSuccess?.(result));
    renderPage();
    run();
    const zero = within(screen.getByRole('table', { name: 'test_supported_mix' }));
    const unknown = within(screen.getByRole('table', { name: 'test_unknown_mix' }));
    expect(zero.getByText('$0.00')).toBeInTheDocument();
    expect(zero.getByText('0.00%')).toBeInTheDocument();
    expect(unknown.getAllByText('Unsupported')).toHaveLength(2);
    expect(unknown.getByText('—')).toBeInTheDocument();
    expect(unknown.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('retains the submitted snapshot and usable result across edits, vehicle changes and refresh failure', () => {
    mocks.mutate.mockImplementation((_request, options) => options?.onSuccess?.(payload()));
    const view = renderPage();
    run();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Annual distance/ }), { target: { value: '30000000' } });
    mocks.state.vehicleId = 3;
    mocks.state.error = new Error('Test-only later run failed');
    view.rerender(<TCOOptimizerPage />);
    expect(screen.getByRole('table', { name: 'test_supported_mix' })).toBeInTheDocument();
    expect(screen.getByText('20000000 m display')).toBeInTheDocument();
    expect(screen.getByText('4.00')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByText('Test-only later run failed')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Annual distance/ })).toHaveValue(30000000);
    assertSections();
  });

  it('keeps retained results visible during pending and paused reruns without claiming fresh success', () => {
    mocks.mutate.mockImplementation((_request, options) => options?.onSuccess?.(payload()));
    const view = renderPage();
    run();
    mocks.state.isPending = true;
    view.rerender(<TCOOptimizerPage />);
    expect(screen.getByRole('table', { name: 'test_supported_mix' })).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    mocks.state.isPaused = true;
    view.rerender(<TCOOptimizerPage />);
    expect(screen.getByText('Cached evidence remains visible while its refresh is paused.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'test_supported_mix' })).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
  });

  it('shows resolved-empty alternatives independently from idle and retains response provenance', () => {
    mocks.mutate.mockImplementation((_request, options) => options?.onSuccess?.(payload({ strategies: [] })));
    renderPage();
    run();
    assertSections();
    expect(screen.getByText('No supported data is available.')).toBeInTheDocument();
    expect(screen.queryByText('Submit constraints to generate supported alternatives.')).not.toBeInTheDocument();
    expect(screen.getByText('Last updated: display date 2026-10-01T12:00:00Z')).toBeInTheDocument();
    expect(screen.getByText(/Test-only projections are not guarantees/)).toBeInTheDocument();
  });

  it('renders initial failure inside alternatives while the constraints and recovery action remain usable', () => {
    mocks.state.error = new Error('Test-only initial failure');
    renderPage();
    assertSections();
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Test-only initial failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate confirmed alternatives' })).toBeEnabled();
    run();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
});
