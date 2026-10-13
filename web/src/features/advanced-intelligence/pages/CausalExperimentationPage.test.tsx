import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { AdvancedPage, CausalExperiment } from '@/types/advancedIntelligence';
import { formatSpeed, type UnitPref } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import CausalExperimentationPage from './CausalExperimentationPage';

const mocks = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  query: vi.fn(),
  refetch: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
  mutation: { data: undefined as CausalExperiment | undefined, error: null as Error | null, isPending: false },
}));
const preferences: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
  energy: 'Wh', duration: 'min', power: 'kW', precision: 2, locale: 'en-US',
};

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useCausalExperiments: mocks.query,
  useCreateCausalExperiment: () => ({ ...mocks.mutation, mutate: mocks.mutate, reset: mocks.reset }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: mocks.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: preferences, formatSpeed: (value: number | null) => formatSpeed(value, 'km/h', { precision: 2, locale: 'en-US' }) }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: 'UTC', formatDateTime: (value: string) => value }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : String(values?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

function experiment(overrides: Partial<CausalExperiment> = {}): CausalExperiment {
  return {
    id: 42, vehicle_id: 4, intervention_kind: 'charging_schedule', metric: 'charging_success_pct',
    baseline_start: '2026-10-01T10:00:00Z', baseline_end: '2026-10-03T10:00:00Z',
    treatment_start: '2026-10-04T10:00:00Z', treatment_end: '2026-10-06T10:00:00Z',
    state: 'estimated', version: 1, baseline_sample_count: 12, treatment_sample_count: 8,
    confounder_coverage_pct: 85, baseline_energy_wh_per_m: null, treatment_energy_wh_per_m: null,
    effect_energy_wh_per_m: null, baseline_success_pct: 75, treatment_success_pct: 50,
    effect_success_pct: -25, baseline_speed_mps: null, treatment_speed_mps: null, effect_speed_mps: null,
    created_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T10:00:00Z',
    data_quality: { status: 'limited', sample_count: 20, coverage_pct: 85,
      window_start: '2026-10-01T10:00:00Z', window_end: '2026-10-06T10:00:00Z',
      reasons: ['Test-only ambient coverage is limited.'] },
    evidence: [{ source: 'test-only historical aggregates', summary: 'Test-only comparison of observed windows.',
      sample_count: 20, observed_at: '2026-10-06T10:00:00Z' }],
    limitations: ['Test-only driver and route confounders remain unobserved.'],
    ...overrides,
  };
}

function payload(items: CausalExperiment[] = [experiment()], total = items.length, offset = 0): AdvancedPage<CausalExperiment> {
  return { items, total, limit: 10, offset };
}

function query(data?: AdvancedPage<CausalExperiment>, overrides: DataStateSource<AdvancedPage<CausalExperiment>> & { isPlaceholderData?: boolean } = {}) {
  return { data, isLoading: false, isFetching: false, isSuccess: data !== undefined,
    isError: false, isPlaceholderData: false, fetchStatus: 'idle', error: null,
    dataUpdatedAt: Date.UTC(2026, 9, 7, 10), refetch: mocks.refetch, ...overrides };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<CausalExperimentationPage />, {
    wrapper: ({ children }) => <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>,
  });
}

function submitReview() {
  const form = screen.getByRole('button', { name: 'Review experiment' }).closest('form');
  if (!form) throw new Error('Expected the existing experiment form');
  fireEvent.submit(form);
}

const windowLabels = ['Baseline start', 'Baseline end', 'Treatment start', 'Treatment end'];
function setWindows(values: string[]) {
  values.forEach((value, index) => fireEvent.change(screen.getByLabelText(windowLabels[index], { exact: false }), { target: { value } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 10, 10));
  mocks.vehicleId = 4;
  mocks.mutation = { data: undefined, error: null, isPending: false };
  mocks.query.mockReturnValue(query(payload()));
});
afterEach(() => vi.restoreAllMocks());

describe('CausalExperimentationPage', () => {
  it('preserves four measurements, samples, quality, evidence and observational limitations', () => {
    renderPage();
    const article = within(screen.getByRole('article'));
    expect(article.getByRole('heading', { name: 'Charging schedule' })).toBeInTheDocument();
    expect(article.getByText('estimated')).toBeInTheDocument();
    expect(article.getByLabelText('Baseline: 75.00%')).toHaveTextContent('12 samples');
    expect(article.getByLabelText('Treatment: 50.00%')).toHaveTextContent('8 samples');
    expect(article.getByLabelText('Estimated effect: -25.00 percentage points')).toBeInTheDocument();
    expect(article.getByLabelText('Confounder coverage: 85.00%')).toBeInTheDocument();
    expect(screen.getByText('Association is not proof of causality')).toBeInTheDocument();
    expect(screen.getByText(/#42/)).toHaveTextContent('Vehicle 4');
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('20');
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('Test-only ambient coverage is limited.');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('test-only historical aggregates');
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Test-only driver and route confounders remain unobserved.');
    expect(screen.getByText(/Randomized assignment or proof of causality/)).toBeInTheDocument();
    expect(screen.getByText(/Execution of the selected intervention/)).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith(4, 10, 0);
  });

  it.each([
    { case: 'energy intensity', item: experiment({ metric: 'drive_energy_wh_per_m',
      baseline_energy_wh_per_m: 0.2, treatment_energy_wh_per_m: 0.15, effect_energy_wh_per_m: -0.05 }),
      expected: ['200.00 Wh/km', '150.00 Wh/km', '-50.00 Wh/km'] },
    { case: 'speed difference', item: experiment({ metric: 'average_speed_mps',
      baseline_speed_mps: 10, treatment_speed_mps: 5, effect_speed_mps: -5 }),
      expected: ['36.00 km/h', '18.00 km/h', '-18.00 km/h'] },
  ])('converts signed $case only at display without changing raw SI', ({ item, expected }) => {
    const original = structuredClone(item);
    mocks.query.mockReturnValue(query(payload([item])));
    renderPage();
    expected.forEach((value) => expect(within(screen.getByRole('article')).getByText(value)).toBeInTheDocument());
    expect(item).toEqual(original);
  });

  it('distinguishes measured zero from missing and invalid values in neutral responsive cards', () => {
    mocks.query.mockReturnValue(query(payload([experiment({
      intervention_kind: 'test_only_' + 'long_identifier_'.repeat(10), state: 'unrecognized',
      baseline_success_pct: 0, treatment_success_pct: null, effect_success_pct: NaN, confounder_coverage_pct: 0,
    })])));
    renderPage();
    const article = screen.getByRole('article');
    expect(article).toHaveClass('min-w-0', 'rounded-panel', 'bg-[var(--surface-2)]', 'border-[var(--border-default)]');
    expect(within(article).getByLabelText('Baseline: 0.00%')).toHaveAttribute('data-state', 'value');
    expect(article.querySelector('[data-metric="percent"][data-state="missing"]')).toHaveTextContent('—');
    expect(article.querySelector('[data-metric="percent"][data-state="invalid"]')).toHaveTextContent('—');
    expect(within(article).getByText('unrecognized')).toHaveClass('text-[var(--text-secondary)]');
    expect(article.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(article.querySelectorAll('[data-stat]')).toHaveLength(4);
  });

  it.each([
    { case: 'initial loading', source: query(undefined, { isLoading: true, fetchStatus: 'fetching' }) },
    { case: 'paused unresolved', source: query(undefined, { fetchStatus: 'paused' }) },
    { case: 'fatal failure', source: query(undefined, { isError: true, error: new Error('Test-only history failure') }) },
    { case: 'resolved empty', source: query(payload([])) },
  ])('keeps every section and unsupported disclosure in $case without invented returned metadata', ({ source }) => {
    mocks.query.mockReturnValue(source);
    renderPage();
    ['Experiment history', 'Create windowed experiment', 'Evidence, quality, and limitations'].forEach((name) =>
      expect(screen.getByRole('heading', { name })).toBeInTheDocument());
    ['Data quality', 'Evidence sources', 'Limitations'].forEach((name) =>
      expect(screen.getByRole('region', { name })).toBeInTheDocument());
    expect(screen.getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review experiment' })).toBeEnabled();
  });

  it('retains independent history and evidence through refresh errors with individual retry', () => {
    mocks.query.mockReturnValue(query(payload(), { isError: true, error: new Error('Test-only refresh failure') }));
    renderPage();
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('test-only historical aggregates');
    const retry = screen.getAllByRole('button', { name: /retry/i })[0];
    fireEvent.click(retry);
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Create windowed experiment' })).toBeInTheDocument();
  });

  it('resets server pagination immediately on workspace changes and excludes prior mutation evidence', () => {
    mocks.query.mockImplementation((vehicleId: number, _limit: number, offset: number) =>
      query(payload([experiment({ vehicle_id: vehicleId })], 25, offset)));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 10, 10);
    mocks.mutation.data = experiment();
    mocks.vehicleId = 3;
    mocks.query.mockReturnValue(query(payload([])));
    view.rerender(<CausalExperimentationPage />);
    expect(mocks.query).toHaveBeenLastCalledWith(3, 10, 0);
    expect(screen.queryByText('test-only historical aggregates')).not.toBeInTheDocument();
    expect(screen.queryByText(/Vehicle 4 · #42/)).not.toBeInTheDocument();
    mocks.vehicleId = 4;
    view.rerender(<CausalExperimentationPage />);
    expect(mocks.query).toHaveBeenLastCalledWith(4, 10, 0);
    expect(screen.getByText('test-only historical aggregates')).toBeInTheDocument();
  });

  it('recovers an out-of-range server page while preserving pagination actions', () => {
    mocks.query.mockImplementation((_vehicleId: number, _limit: number, offset: number) =>
      query(payload(offset > 0 ? [] : [experiment()], offset > 0 ? 1 : 25, offset)));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mocks.query).toHaveBeenLastCalledWith(4, 10, 0);
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });

  it('does not reuse another scope or placeholder record as evidence', () => {
    mocks.query.mockReturnValue(query(payload([experiment({ vehicle_id: 3 })]), { isPlaceholderData: true }));
    renderPage();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('test-only historical aggregates')).not.toBeInTheDocument();
    expect(screen.getAllByText('Evidence availability has not resolved yet.')).toHaveLength(3);
  });

  it('keeps all controls accessible and disables review without a workspace vehicle', () => {
    mocks.vehicleId = null;
    mocks.query.mockReturnValue(query());
    renderPage();
    expect(screen.getByRole('button', { name: 'Review experiment' })).toBeDisabled();
    expect(screen.getByLabelText('Intervention')).toHaveAttribute('id', 'causal-intervention');
    expect(screen.getByLabelText('Metric')).toHaveAttribute('id', 'causal-metric');
    windowLabels.forEach((label) => {
      const input = screen.getByLabelText(label, { exact: false });
      expect(input).toHaveClass('min-h-11', 'md:min-h-10');
      expect(input).toHaveAttribute('required');
      expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')).toHaveTextContent('Windows must be ordered');
    });
  });

  it('reviews immutable local-to-UTC windows and sends one confirmed estimate only after confirmation', () => {
    renderPage();
    const values = ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-06T10:00'];
    setWindows(values);
    submitReview();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Charging schedule')).toBeInTheDocument();
    expect(dialog.getByText('Charging success')).toBeInTheDocument();
    expect(dialog.getByText(/does not execute the intervention or prove causality/)).toBeInTheDocument();
    values.forEach((value) => expect(dialog.getByText(`${new Date(value).toISOString()} · UTC`)).toBeInTheDocument());
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'average_speed_mps' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create estimate' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Create estimate' }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate.mock.calls[0][0]).toEqual({
      vehicle_id: 4, confirmed: true, intervention_kind: 'charging_schedule', metric: 'charging_success_pct',
      baseline_start: new Date(values[0]).toISOString(), baseline_end: new Date(values[1]).toISOString(),
      treatment_start: new Date(values[2]).toISOString(), treatment_end: new Date(values[3]).toISOString(),
    });
  });

  it('stacks every reviewed detail with wrapping while preserving cancel and confirm actions', () => {
    renderPage();
    const values = ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-06T10:00'];
    setWindows(values);
    submitReview();
    const dialog = within(screen.getByRole('dialog'));
    const list = dialog.getByText('Vehicle', { selector: 'dt' }).closest('dl');
    if (!list) throw new Error('Expected the shared review details definition list');
    const rows = Array.from(list.children);
    expect(rows).toHaveLength(7);
    expect(Array.from(list.querySelectorAll('dt'), (label) => label.textContent)).toEqual([
      'Vehicle', 'Intervention', 'Metric', ...windowLabels,
    ]);
    expect(Array.from(list.querySelectorAll('dd'), (value) => value.textContent)).toEqual([
      '4', 'Charging schedule', 'Charging success',
      ...values.map((value) => `${new Date(value).toISOString()} · UTC`),
    ]);
    rows.forEach((row) => {
      expect(row).toHaveClass('flex', 'min-w-0', 'flex-col', 'gap-1');
      expect(row).not.toHaveClass('justify-between');
      row.querySelectorAll('dt, dd').forEach((cell) =>
        expect(cell).toHaveClass('min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]'));
    });
    expect(dialog.getByRole('button', { name: 'Create estimate' })).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    submitReview();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ vehicle_id: 4, confirmed: true });
  });

  it('disables reviewed confirmation after a workspace change without retargeting the request', () => {
    const view = renderPage();
    submitReview();
    mocks.vehicleId = 3;
    view.rerender(<CausalExperimentationPage />);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' })).toBeDisabled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps server rejection visible in the open review and retains the form for retry or cancel', () => {
    const view = renderPage();
    submitReview();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' }));
    const callbacks = mocks.mutate.mock.calls[0][1] as { onSettled: () => void };
    callbacks.onSettled();
    mocks.mutation.error = new Error('Test-only server window rejection');
    view.rerender(<CausalExperimentationPage />);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Test-only server window rejection');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' })).toBeEnabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Test-only server window rejection');
    expect(screen.getByLabelText('Baseline start', { exact: false })).not.toHaveValue('');
  });

  it('keeps pending review nondismissible and closes only on actual success', () => {
    const view = renderPage();
    submitReview();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' }));
    mocks.mutation.isPending = true;
    view.rerender(<CausalExperimentationPage />);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const callbacks = mocks.mutate.mock.calls[0][1] as { onSuccess: () => void; onSettled: () => void };
    mocks.mutation.isPending = false;
    act(() => { callbacks.onSuccess(); callbacks.onSettled(); });
    view.rerender(<CausalExperimentationPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    { case: 'invalid date', values: ['', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-06T10:00'] },
    { case: 'reversed baseline', values: ['2026-10-03T10:00', '2026-10-01T10:00', '2026-10-04T10:00', '2026-10-06T10:00'] },
    { case: 'short baseline', values: ['2026-10-01T10:00', '2026-10-02T09:59', '2026-10-04T10:00', '2026-10-06T10:00'] },
    { case: 'overlong baseline', values: ['2025-10-01T10:00', '2026-10-01T10:01', '2026-10-04T10:00', '2026-10-06T10:00'] },
    { case: 'overlapping windows', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-03T09:59', '2026-10-06T10:00'] },
    { case: 'short treatment', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-05T09:59'] },
    { case: 'overlong treatment', values: ['2025-08-01T10:00', '2025-08-03T10:00', '2025-08-04T10:00', '2026-08-04T10:01'] },
    { case: 'beyond future tolerance', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-10T10:02'] },
  ])('rejects $case before opening review without calling the server', ({ values }) => {
    renderPage();
    setWindows(values);
    submitReview();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Baseline start', { exact: false })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Baseline start', { exact: false })).toHaveFocus();
  });

  it.each([
    { case: 'minimum duration and touching windows', values: ['2026-10-01T10:00', '2026-10-02T10:00', '2026-10-02T10:00', '2026-10-03T10:00'] },
    { case: 'maximum duration', values: ['2025-10-01T10:00', '2026-10-01T10:00', '2026-10-02T10:00', '2026-10-03T10:00'] },
    { case: 'one-minute server tolerance', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-10T10:01'] },
  ])('preserves $case at the authoritative boundary', ({ values }) => {
    renderPage();
    setWindows(values);
    submitReview();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
