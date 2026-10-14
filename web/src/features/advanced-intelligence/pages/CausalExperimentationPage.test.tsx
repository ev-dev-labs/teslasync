import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { AdvancedPage, CausalExperiment } from '@/types/advancedIntelligence';
import { formatSpeed, type UnitPref } from '@/lib/unitConversion';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { formatTime } from '@/lib/dateFormat';
import CausalExperimentationPage from './CausalExperimentationPage';
import english from '@/i18n/en.json';

const mocks = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  query: vi.fn(),
  refetch: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
  mutation: { data: undefined as CausalExperiment | undefined, error: null as Error | null, isPending: false },
  translations: {} as Record<string, string>,
  translate: vi.fn(),
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
  useUnits: () => ({ unitPrefs: preferences, formatSpeed: (value: number | null) => formatSpeed(value, preferences, { precision: 2 }) }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt, fmtNumber }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: 'UTC',
    formatDateTime: (value: string) => value,
    formatTime: (value: Date) => formatTime(value, { tz: 'UTC', locale: 'en-US' }),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      mocks.translate(key);
      if (Object.hasOwn(mocks.translations, key)) return mocks.translations[key];
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
  vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 10, 10).getTime());
  mocks.vehicleId = 4;
  mocks.translations = {};
  mocks.mutation = { data: undefined, error: null, isPending: false };
  mocks.query.mockReturnValue(query(payload()));
});
afterEach(() => vi.restoreAllMocks());

describe('CausalExperimentationPage', () => {
  it('preserves four measurements, samples, quality, evidence and observational limitations', () => {
    renderPage();
    const article = within(screen.getByRole('article'));
    expect(article.getByRole('heading', { name: 'Charging schedule' })).toBeInTheDocument();
    expect(article.getByText('Estimated')).toBeInTheDocument();
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
    ['estimated', 'estimated', 'Estimated'],
    ['insufficient', 'insufficient', 'Insufficient evidence'],
    ['non_causal', 'nonCausal', 'Non-causal'],
  ] as const)('localizes %s using canonical copy without rewriting returned tokens or narrative', (state, labelKey, fallback) => {
    const key = `advancedIntelligence.causal.state.${labelKey}`;
    expect(english.advancedIntelligence.causal.state[labelKey]).toBe(fallback);
    mocks.translations[key] = `Localized ${fallback}`;
    const item = experiment({ state });
    const original = structuredClone(item);
    mocks.query.mockReturnValue(query(payload([item])));
    renderPage();
    expect(within(screen.getByRole('article')).getByText(`Localized ${fallback}`)).toBeInTheDocument();
    expect(screen.getByText(item.evidence[0].summary)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent(item.limitations[0]);
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent(item.data_quality.reasons[0]);
    expect(mocks.translate).toHaveBeenCalledWith(key);
    expect(mocks.translate).not.toHaveBeenCalledWith(item.evidence[0].summary);
    expect(mocks.translate).not.toHaveBeenCalledWith(item.limitations[0]);
    expect(mocks.translate).not.toHaveBeenCalledWith(item.data_quality.reasons[0]);
    expect(item).toEqual(original);
  });

  it.each(['future_state_v2', 'estimated.future', 'toString', '<future-state>'])(
    'preserves the raw unknown state %s without speculative translation', (state) => {
      const item = experiment({ state });
      mocks.query.mockReturnValue(query(payload([item])));
      renderPage();
      expect(within(screen.getByRole('article')).getByText(state)).toHaveClass('text-[var(--text-secondary)]');
      expect(mocks.translate).not.toHaveBeenCalledWith(state);
      expect(item.state).toBe(state);
    },
  );

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
    { case: 'overlapping windows', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-03T09:59', '2026-10-06T10:00'], bad: [2] },
    { case: 'short treatment', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-05T09:59'], bad: [2, 3] },
    { case: 'overlong treatment', values: ['2025-08-01T10:00', '2025-08-03T10:00', '2025-08-04T10:00', '2026-08-04T10:01'], bad: [2, 3] },
    { case: 'beyond future tolerance', values: ['2026-10-01T10:00', '2026-10-03T10:00', '2026-10-04T10:00', '2026-10-10T10:02'], bad: [3] },
  ])('rejects $case before opening review without calling the server', ({ values, bad }) => {
    renderPage();
    setWindows(values);
    submitReview();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    if (bad) {
      windowLabels.forEach((label, index) => {
        const input = screen.getByLabelText(label, { exact: false });
        if (bad.includes(index)) {
          expect(input).toHaveAttribute('aria-invalid', 'true');
        } else {
          expect(input).not.toHaveAttribute('aria-invalid', 'true');
          expect(input).not.toHaveFocus();
        }
      });
      expect(screen.getByLabelText(windowLabels[bad[0]], { exact: false })).toHaveFocus();
    } else {
      expect(screen.getByLabelText('Baseline start', { exact: false })).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText('Baseline start', { exact: false })).toHaveFocus();
    }
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


describe('Causal window field validation', () => {
  const day = 24 * 60 * 60 * 1000;
  const minute = 60 * 1000;
  const now = new Date(2026, 9, 10, 10).getTime();
  const durationError = 'Each window must last from 24 hours to 365 days.';
  const dateError = 'Enter a valid date and time.';
  const overlapError = 'Treatment start must be at or after baseline end.';
  const futureError = 'Treatment end must not be more than 1 minute in the future.';
  // Build minute-resolution local controls from exact elapsed instants, without
  // changing the page's existing datetime-local parsing or timezone contract.
  const localMinute = (instant: number) => {
    const date = new Date(instant);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const dates = (offsets: number[]) => offsets.map((offset) => localMinute(now + offset));
  const standard = dates([-9 * day, -7 * day, -6 * day, -4 * day]);

  it('retains every violated bound under stable field IDs and links the summary to the actual controls', () => {
    mocks.translations['advancedIntelligence.causal.form.treatmentStart'] = 'Localized start';
    mocks.translations['advancedIntelligence.causal.form.treatmentEnd'] = 'Localized end';
    renderPage();
    const values = dates([-9 * day, -7 * day, -400 * day, 2 * minute]);
    values.forEach((value, index) => {
      const input = document.getElementById(`causal-${['baseline_start', 'baseline_end', 'treatment_start', 'treatment_end'][index]}`);
      if (!input) throw new Error('Expected the existing window control');
      fireEvent.change(input, { target: { value } });
    });
    submitReview();
    const start = screen.getByLabelText('Localized start', { exact: false });
    const end = screen.getByLabelText('Localized end', { exact: false });
    expect(start).toHaveFocus();
    expect(document.getElementById(`${start.id}-error`)).toHaveTextContent(`${durationError} ${overlapError}`);
    expect(document.getElementById(`${end.id}-error`)).toHaveTextContent(`${durationError} ${futureError}`);
    const summary = screen.getByRole('alert', { name: 'Fix 2 problems before continuing' });
    fireEvent.click(within(summary).getByRole('button', { name: `Localized end: ${durationError} ${futureError}` }));
    expect(end).toHaveFocus();
    fireEvent.change(end, { target: { value: standard[3] } });
    expect(end).toHaveFocus();
    expect(document.getElementById(`${end.id}-error`)).toHaveTextContent(durationError);
    expect(document.getElementById(`${end.id}-error`)).not.toHaveTextContent(futureError);
    fireEvent.click(within(summary).getByRole('button', { name: `Localized start: ${durationError} ${overlapError}` }));
    expect(start).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { case: 'missing baseline start', values: ['', ...standard.slice(1)], bad: [0], message: dateError },
    { case: 'missing baseline end', values: [standard[0], '', ...standard.slice(2)], bad: [1], message: dateError },
    { case: 'missing treatment start', values: [...standard.slice(0, 2), '', standard[3]], bad: [2], message: dateError },
    { case: 'missing treatment end', values: [...standard.slice(0, 3), ''], bad: [3], message: dateError },
    { case: 'baseline-only reversed duration', values: dates([-7 * day, -9 * day, -6 * day, -4 * day]), bad: [0, 1], message: durationError },
    { case: 'treatment-only reversed duration', values: dates([-9 * day, -7 * day, -4 * day, -6 * day]), bad: [2, 3], message: durationError },
    { case: 'baseline-only one minute below 24 hours', values: dates([-9 * day, -8 * day - minute, -6 * day, -4 * day]), bad: [0, 1], message: durationError },
    { case: 'treatment-only one minute below 24 hours', values: dates([-9 * day, -7 * day, -6 * day, -5 * day - minute]), bad: [2, 3], message: durationError },
    { case: 'baseline-only one minute above 365 days', values: dates([-400 * day, -35 * day + minute, -6 * day, -4 * day]), bad: [0, 1], message: durationError },
    { case: 'treatment-only one minute above 365 days', values: dates([-371 * day, -369 * day, -367 * day, -2 * day + minute]), bad: [2, 3], message: durationError },
    { case: 'one minute of overlap', values: dates([-9 * day, -7 * day, -7 * day - minute, -4 * day]), bad: [2], message: overlapError },
    { case: 'treatment ordered before baseline', values: dates([-6 * day, -4 * day, -9 * day, -7 * day]), bad: [2], message: overlapError },
    { case: 'one millisecond beyond future tolerance', values: dates([-9 * day, -7 * day, -6 * day, minute]), bad: [3], message: futureError, clock: now - 1 },
  ])('rejects $case with field-specific errors and focus without mutation', ({ values, bad, message, clock }) => {
    if (clock !== undefined) vi.mocked(Date.now).mockReturnValue(clock);
    renderPage();
    setWindows(values);
    submitReview();
    windowLabels.forEach((label, index) => {
      const input = screen.getByLabelText(label, { exact: false });
      const errorId = `${input.id}-error`;
      if (bad.includes(index)) {
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAttribute('aria-describedby', errorId);
        expect(document.getElementById(errorId)).toHaveTextContent(message);
      } else {
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById(errorId)).not.toBeInTheDocument();
        expect(input).not.toHaveFocus();
      }
    });
    expect(screen.getByLabelText(windowLabels[bad[0]], { exact: false })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { case: 'exact baseline 24-hour minimum', values: dates([-9 * day, -8 * day, -6 * day, -4 * day]) },
    { case: 'exact treatment 24-hour minimum', values: dates([-9 * day, -7 * day, -6 * day, -5 * day]) },
    { case: 'exact baseline 365-day maximum', values: dates([-400 * day, -35 * day, -6 * day, -4 * day]) },
    { case: 'exact treatment 365-day maximum', values: dates([-371 * day, -369 * day, -367 * day, -2 * day]) },
    { case: 'touching non-overlapping windows', values: dates([-9 * day, -7 * day, -7 * day, -4 * day]) },
    { case: 'ordered separated windows', values: standard },
    { case: 'exact one-minute future tolerance', values: dates([-9 * day, -7 * day, -6 * day, minute]) },
  ])('reviews $case without invalid fields or pre-confirmation mutation', ({ values }) => {
    renderPage();
    setWindows(values);
    submitReview();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    windowLabels.forEach((label) => expect(screen.getByLabelText(label, { exact: false })).not.toHaveAttribute('aria-invalid', 'true'));
    const dialog = within(screen.getByRole('dialog'));
    values.forEach((value, index) => {
      const row = dialog.getByText(windowLabels[index], { selector: 'dt' }).parentElement;
      if (!row) throw new Error('Expected the reviewed window field row');
      expect(within(row).getByText(`${new Date(value).toISOString()} · UTC`)).toBeInTheDocument();
    });
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('discloses the 24-hour minimum 365-day maximum and one-minute future tolerance on every field', () => {
    renderPage();
    windowLabels.forEach((label) => {
      const input = screen.getByLabelText(label, { exact: false });
      const hint = document.getElementById(input.getAttribute('aria-describedby') ?? '');
      expect(hint).toHaveTextContent('ordered and non-overlapping');
      expect(hint).toHaveTextContent('24 hours to 365 days');
      expect(hint).toHaveTextContent('up to 1 minute of clock tolerance');
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('native required invalidation identifies only the missing treatment endpoint', () => {
    renderPage();
    setWindows([...standard.slice(0, 3), '']);
    const treatmentEnd = screen.getByLabelText('Treatment end', { exact: false });
    fireEvent.invalid(treatmentEnd);
    expect(treatmentEnd).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('causal-treatment_end-error')).toHaveTextContent(dateError);
    windowLabels.slice(0, 3).forEach((label) => expect(screen.getByLabelText(label, { exact: false })).not.toHaveAttribute('aria-invalid', 'true'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('corrective treatment edit clears its paired errors while unrelated baseline errors remain', () => {
    renderPage();
    setWindows(dates([-9 * day, -8 * day - minute, -6 * day, -5 * day - minute]));
    submitReview();
    windowLabels.forEach((label) => expect(screen.getByLabelText(label, { exact: false })).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'average_speed_mps' } });
    windowLabels.forEach((label) => expect(screen.getByLabelText(label, { exact: false })).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(screen.getByLabelText('Treatment end', { exact: false }), { target: { value: localMinute(now - 5 * day) } });
    windowLabels.slice(0, 2).forEach((label) => expect(screen.getByLabelText(label, { exact: false })).toHaveAttribute('aria-invalid', 'true'));
    windowLabels.slice(2).forEach((label) => {
      const input = screen.getByLabelText(label, { exact: false });
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
      expect(document.getElementById(`${input.id}-error`)).not.toBeInTheDocument();
      expect(input).toHaveAttribute('aria-describedby', `${input.id}-hint`);
    });
    submitReview();
    expect(screen.getByLabelText('Baseline start', { exact: false })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Baseline end', { exact: false }), { target: { value: localMinute(now - 8 * day) } });
    windowLabels.forEach((label) => expect(screen.getByLabelText(label, { exact: false })).not.toHaveAttribute('aria-invalid', 'true'));
    submitReview();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { case: 'missing endpoint', values: [...standard.slice(0, 3), ''], field: 'Treatment end', correction: standard[3] },
    { case: 'overlap', values: dates([-9 * day, -7 * day, -7 * day - minute, -4 * day]), field: 'Treatment start', correction: standard[2] },
    { case: 'future endpoint', values: dates([-9 * day, -7 * day, -6 * day, 2 * minute]), field: 'Treatment end', correction: standard[3] },
  ])('corrective edit clears actual $case error and permits review without mutation', ({ values, field, correction }) => {
    renderPage();
    setWindows(values);
    submitReview();
    const input = screen.getByLabelText(field, { exact: false });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: correction } });
    windowLabels.forEach((label) => expect(screen.getByLabelText(label, { exact: false })).not.toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(`${input.id}-error`)).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-describedby', `${input.id}-hint`);
    expect(mocks.mutate).not.toHaveBeenCalled();
    submitReview();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('valid immutable confirmation survives subsequent invalid date edits and duplicate clicks', () => {
    renderPage();
    setWindows(standard);
    submitReview();
    expect(mocks.mutate).not.toHaveBeenCalled();
    const reviewed = {
      vehicle_id: 4, confirmed: true, intervention_kind: 'charging_schedule', metric: 'charging_success_pct',
      baseline_start: new Date(standard[0]).toISOString(), baseline_end: new Date(standard[1]).toISOString(),
      treatment_start: new Date(standard[2]).toISOString(), treatment_end: new Date(standard[3]).toISOString(),
    };
    setWindows(['', '', '', '']);
    fireEvent.change(screen.getByLabelText('Intervention'), { target: { value: 'tire_service' } });
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'average_speed_mps' } });
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate.mock.calls[0][0]).toEqual(reviewed);
  });
});
