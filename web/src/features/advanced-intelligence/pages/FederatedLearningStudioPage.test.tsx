import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { DataStateSource } from '@/api/dataState';
import type {
  FederatedModelCard, FederatedRoundResult, FederatedStatusPage, StartFederatedRoundRequest,
} from '@/types/advancedIntelligence';
import FederatedLearningStudioPage from './FederatedLearningStudioPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<FederatedStatusPage>,
  read: vi.fn(),
  retry: vi.fn(),
  mutation: {
    mutate: vi.fn(),
    data: undefined as FederatedRoundResult | undefined,
    variables: undefined as StartFederatedRoundRequest | undefined,
    error: null as Error | null,
    isPending: false,
  },
}));

let savedPreferences = getFormatterPreferences();

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useFederatedModelCards: (...args: unknown[]) => {
    state.read(...args);
    return state.query;
  },
  useStartFederatedRound: () => state.mutation,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'Wh', duration: 'h', power: 'W', locale: 'en-US',
    },
  }),
}));

const card: FederatedModelCard = {
  id: 17, vehicle_id: 7, model_name: 'local-efficiency', model_version: 'v2',
  task: 'efficiency', version: 3, epsilon_budget: 2, epsilon_spent: 0.4,
  round_count: 4, latest_sample_count: 0, latest_metric_wh_per_m: 0.25,
  latest_status: 'completed', updated_at: '2026-08-04T00:00:00Z',
  limitations: ['Local aggregate only.'],
};

function populate(items = [card], total = items.length) {
  state.query.data = {
    vehicle_id: state.vehicleId ?? 7, items: structuredClone(items), total, limit: 12, offset: 0,
    total_epsilon_budget: 10, total_epsilon_spent: 0.4,
    privacy_statement: 'Synthetic local aggregate privacy policy.',
    data_quality: {
      status: 'limited', sample_count: 0, coverage_pct: null,
      window_start: null, window_end: null, reasons: ['Local coverage only.'],
    },
    evidence: [{ source: 'local-budget', observed_at: null, sample_count: 0, summary: 'Subject-local evidence.' }],
    generated_at: '2026-08-04T00:00:00Z',
  };
}

function completedRound(vehicleId = 7): FederatedRoundResult {
  return {
    model_card: { ...card, vehicle_id: vehicleId, limitations: ['Round-local limitation.'] },
    round: {
      id: 9, model_card_id: card.id, round_number: 5, requested_epsilon: 0.1,
      epsilon_spent: 0.1, sample_count: 5, local_metric_wh_per_m: 0.25,
      clipped_update_pct: null, status: 'completed',
      started_at: '2026-08-04T00:00:00Z', completed_at: '2026-08-04T00:01:00Z',
    },
    data_quality: {
      status: 'sufficient', sample_count: 5, coverage_pct: 80,
      window_start: null, window_end: null, reasons: ['Round-local coverage.'],
    },
    evidence: [{ source: 'local-round', observed_at: null, sample_count: 5, summary: 'Round-local evidence.' }],
  };
}

function evidenceContainer() {
  return screen.getByRole('region', { name: 'Evidence sources' }).parentElement!;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  }
  const view = render(<FederatedLearningStudioPage />, { wrapper: Providers });
  return { ...view, update: () => view.rerender(<FederatedLearningStudioPage />) };
}

function review(name = 'reviewed-local-model') {
  fireEvent.change(screen.getByLabelText(/^Model name/), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Review privacy spend' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  savedPreferences = getFormatterPreferences();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.query = { fetchStatus: 'idle', refetch: state.retry };
  Object.assign(state.mutation, { data: undefined, variables: undefined, error: null, isPending: false });
  window.localStorage.clear();
});

afterEach(() => {
  setGlobalLocale(savedPreferences.locale);
  setGlobalPrecision(savedPreferences.precision);
});

describe('Federated learning studio scoped adoption', () => {
  it.each([
    { epsilon: 0.01, precision: 0, locale: 'en-US', displayed: '0.01' },
    { epsilon: 0.1, precision: 1, locale: 'de-DE', displayed: '0,10' },
    { epsilon: 1.25, precision: 0, locale: 'de-DE', displayed: '1,25' },
    { epsilon: 5, precision: 3, locale: 'en-US', displayed: '5.000' },
  ])('formats a valid $epsilon privacy spend at precision $precision without changing consent or payload', ({
    epsilon, precision, locale, displayed,
  }) => {
    setGlobalPrecision(precision);
    setGlobalLocale(locale);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Requested epsilon/), { target: { value: String(epsilon) } });
    const budget = Math.max(2, epsilon);
    fireEvent.change(screen.getByLabelText(/^Epsilon budget/), { target: { value: String(budget) } });
    const dialog = review();
    expect(screen.getByLabelText<HTMLInputElement>(/^Requested epsilon/).form?.checkValidity()).toBe(true);
    expect(within(dialog).getByText(
      `This local round may spend ${displayed} epsilon. It never uploads raw vehicle data.`,
    )).toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Requested epsilon/), { target: { value: '0.7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start local round' }));
    expect(state.mutation.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, model_name: 'reviewed-local-model', model_version: 'v1',
      task: 'efficiency', epsilon, epsilon_budget: budget, expected_version: 0, confirmed: true,
    }, { onSuccess: expect.any(Function) });
  });

  it('sizes only the round fields for mobile while retaining desktop sizing and native validation', () => {
    renderPage();
    const labels = [
      /^Model name/, /^Model version/, /^Task/, /^Requested epsilon/,
      /^Epsilon budget/, /^Expected model-card version/,
    ];
    labels.forEach(label => {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'md:min-h-10');
    });
    expect(screen.getByLabelText(/^Model name/)).toHaveAttribute('required');
    expect(screen.getByLabelText(/^Model name/)).toHaveAttribute('maxlength', '120');
    expect(screen.getByLabelText(/^Model version/)).toHaveAttribute('required');
    expect(screen.getByLabelText(/^Requested epsilon/)).toHaveAttribute('min', '0.01');
    expect(screen.getByLabelText(/^Requested epsilon/)).toHaveAttribute('max', '5');
    expect(screen.getByLabelText(/^Requested epsilon/)).toHaveAttribute('step', '0.01');
    expect(screen.getByLabelText(/^Epsilon budget/)).toHaveAttribute('min', '0.1');
    expect(screen.getByLabelText(/^Epsilon budget/)).toHaveAttribute('max', '20');
    expect(screen.getByLabelText(/^Expected model-card version/)).toHaveAttribute('min', '0');
    const name = screen.getByLabelText<HTMLInputElement>(/^Model name/);
    expect(name.form?.checkValidity()).toBe(false);
    fireEvent.change(name, { target: { value: 'valid-local-model' } });
    expect(name.form?.checkValidity()).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Requested epsilon/), { target: { value: '6' } });
    expect(name.form?.checkValidity()).toBe(false);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('preserves successful empty model cards and zero privacy budgets through retry and recovery', () => {
    populate([]);
    Object.assign(state.query.data!, { total_epsilon_budget: 0, total_epsilon_spent: 0 });
    state.query.isSuccess = true;
    const view = renderPage();
    const brief = screen.getByTestId('advanced-intelligence-federated-brief');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    expect(within(brief).getAllByText('0.00')).toHaveLength(3);
    expect(screen.getByText('No local model cards exist for this vehicle and subject.')).toBeInTheDocument();
    state.query.error = new Error('Zero-budget refresh failed.');
    view.update();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(within(brief).getAllByText('0.00')).toHaveLength(3);
    state.query.error = null;
    view.update();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('Retained result')).not.toBeInTheDocument();
    expect(within(brief).getAllByText('0.00')).toHaveLength(3);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('preserves all model metadata, raw SI, zero and unknown readings with contextual calm cards', () => {
    const unknown: FederatedModelCard = {
      ...card, id: 18, model_name: 'unbroken-model-name-'.repeat(6),
      latest_sample_count: null, latest_metric_wh_per_m: null, latest_status: null,
    };
    populate([card, unknown]);
    const original = structuredClone(state.query.data);
    renderPage();
    const table = screen.getByRole('table', { name: 'local-efficiency' });
    expect(table.closest('[data-table-variant]')).toHaveAttribute('data-table-variant', 'embedded');
    ['Epsilon', 'Rounds', 'Latest local samples', 'Local aggregate']
      .forEach(label => expect(within(table).getByRole('rowheader', { name: label })).toBeInTheDocument());
    expect(within(table).getByRole('cell', { name: '0.40 / 2.00' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '250.00 Wh/km' })).toBeInTheDocument();
    const unknownTable = screen.getByRole('table', { name: unknown.model_name });
    expect(within(unknownTable).getAllByRole('cell', { name: '—' })).toHaveLength(2);
    const article = unknownTable.closest('article');
    expect(article).toHaveClass('min-w-0', 'break-words', 'bg-[var(--surface-2)]', 'border-[var(--border-default)]');
    expect(screen.getByRole('button', { name: `Use for next local round ${unknown.model_name}` }))
      .toHaveClass('min-h-11', 'md:min-h-9');
    expect(screen.getByText('No round')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('completed')).toHaveClass('text-[var(--semantic-success)]');
    expect(state.query.data).toEqual(original);
    expect(screen.getByTestId('advanced-intelligence-federated-brief')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select vehicle')).not.toBeInTheDocument();
  });

  it('only warns for source-confirmed insufficient rounds and preserves unfamiliar status text', () => {
    populate([
      { ...card, latest_status: 'insufficient' },
      { ...card, id: 18, model_name: 'other-model', latest_status: 'future-status' },
    ]);
    renderPage();
    expect(screen.getByText('insufficient')).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.getByText('future-status')).toHaveClass('text-[var(--text-secondary)]');
  });

  it('prefills every original field and retains the exhausted-budget epsilon floor without spending', () => {
    populate([{ ...card, epsilon_spent: 2 }]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use for next local round local-efficiency' }));
    expect(screen.getByLabelText(/^Model name/)).toHaveValue('local-efficiency');
    expect(screen.getByLabelText(/^Model version/)).toHaveValue('v2');
    expect(screen.getByLabelText(/^Task/)).toHaveValue('efficiency');
    expect(screen.getByLabelText(/^Requested epsilon/)).toHaveValue(0.01);
    expect(screen.getByLabelText(/^Epsilon budget/)).toHaveValue(2);
    expect(screen.getByLabelText(/^Expected model-card version/)).toHaveValue(3);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('requires explicit consent and submits exactly the reviewed snapshot rather than later draft edits', () => {
    renderPage();
    const dialog = review();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/never uploads raw vehicle data/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Requested epsilon/), { target: { value: '0.7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start local round' }));
    expect(state.mutation.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, model_name: 'reviewed-local-model', model_version: 'v1',
      task: 'efficiency', epsilon: 0.1, epsilon_budget: 2, expected_version: 0, confirmed: true,
    }, { onSuccess: expect.any(Function) });
    act(() => state.mutation.mutate.mock.calls[0][1].onSuccess());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels review without mutation and retains the editable draft', () => {
    renderPage();
    fireEvent.click(within(review()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Model name/)).toHaveValue('reviewed-local-model');
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('resets pagination, unsubmitted draft and consent immediately on workspace changes and return', () => {
    populate([card], 24);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 12);
    review();
    state.vehicleId = 8;
    populate([], 0);
    view.update();
    expect(state.read).toHaveBeenLastCalledWith(8, 12, 0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Model name/)).toHaveValue('');
    expect(screen.getByLabelText(/^Requested epsilon/)).toHaveValue(0.1);
    state.vehicleId = 7;
    populate();
    view.update();
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 0);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps real mutation errors inside the confirmation for explicit retry without clearing its snapshot', () => {
    const view = renderPage();
    fireEvent.click(within(review()).getByRole('button', { name: 'Start local round' }));
    const request = state.mutation.mutate.mock.calls[0][0] as StartFederatedRoundRequest;
    state.mutation.variables = request;
    state.mutation.error = new Error('Synthetic privacy budget rejection.');
    view.update();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Synthetic privacy budget rejection.');
    expect(screen.getByLabelText(/^Model name/)).toHaveValue('reviewed-local-model');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start local round' }));
    expect(state.mutation.mutate.mock.calls[1][0]).toEqual(request);
  });

  it('retains in-flight outcomes but never attaches old-vehicle evidence or completion to a new review', () => {
    populate();
    const view = renderPage();
    fireEvent.click(within(review()).getByRole('button', { name: 'Start local round' }));
    const oldSuccess = state.mutation.mutate.mock.calls[0][1].onSuccess as () => void;
    state.mutation.variables = state.mutation.mutate.mock.calls[0][0] as StartFederatedRoundRequest;
    state.vehicleId = 8;
    populate([{ ...card, vehicle_id: 8 }]);
    state.mutation.data = {
      model_card: card,
      round: {
        id: 9, model_card_id: card.id, round_number: 5, requested_epsilon: 0.1,
        epsilon_spent: 0.1, sample_count: 5, local_metric_wh_per_m: 0.25,
        clipped_update_pct: null, status: 'completed', started_at: '2026-08-04T00:00:00Z', completed_at: null,
      },
      data_quality: state.query.data!.data_quality,
      evidence: [{ source: 'old-vehicle-round', observed_at: null, sample_count: 5, summary: 'Old scoped outcome.' }],
    };
    state.mutation.error = new Error('Old vehicle failure.');
    view.update();
    const newDialog = review('new-local-model');
    act(oldSuccess);
    expect(screen.getByRole('dialog')).toBe(newDialog);
    expect(screen.queryByText('old-vehicle-round')).not.toBeInTheDocument();
    expect(screen.queryByText('Old vehicle failure.')).not.toBeInTheDocument();
    expect(screen.getByText('local-budget')).toBeInTheDocument();
    expect(state.mutation.data.evidence[0].source).toBe('old-vehicle-round');
  });

  it.each([
    { name: 'loading', source: { isLoading: true, fetchStatus: 'fetching' as const } },
    { name: 'paused', source: { fetchStatus: 'paused' as const } },
    { name: 'unresolved', source: { fetchStatus: 'idle' as const } },
    { name: 'fatal', source: { error: new Error('Synthetic read failure.') } },
  ])('keeps every independent section and privacy non-capability during $name', ({ source }) => {
    Object.assign(state.query, source);
    renderPage();
    ['Subject privacy budget', 'Subject-scoped model cards', 'Privacy-gated local training round', 'Evidence, quality, and limitations']
      .forEach(name => expect(screen.getByRole('heading', { name })).toBeInTheDocument());
    expect(screen.getByText('Raw vehicle data never leaves this instance')).toBeInTheDocument();
    expect(screen.getByText(/^• Raw-data or gradient upload$/)).toBeInTheDocument();
    expect(screen.getByText(/^• A centralized fleet model or cross-subject access$/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('retains cards on refresh failure and paused refresh with independent source retry', () => {
    populate();
    const view = renderPage();
    state.query.error = new Error('Synthetic refresh failure.');
    view.update();
    expect(screen.getByRole('table', { name: 'local-efficiency' })).toBeInTheDocument();
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(1);
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.query.error = null;
    state.query.fetchStatus = 'paused';
    view.update();
    expect(screen.getByRole('table', { name: 'local-efficiency' })).toBeInTheDocument();
    expect(screen.getByText('Cached evidence remains visible while its refresh is paused.')).toBeInTheDocument();
  });

  it('guides no-vehicle selection and disables review without fabricating a privacy spend', () => {
    state.vehicleId = null;
    renderPage();
    expect(state.read).toHaveBeenLastCalledWith(null, 12, 0);
    expect(screen.getAllByText('Select a vehicle to load intelligence.')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Review privacy spend' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'healthy', source: {} },
    { name: 'refresh failed', source: { error: new Error('Synthetic list refresh failure.') } },
    { name: 'refresh paused', source: { fetchStatus: 'paused' as const } },
  ])('pairs the winning round metadata and trust independently of a $name list', ({ source }) => {
    populate();
    Object.assign(state.query, source);
    state.mutation.data = completedRound();
    const before = structuredClone({ list: state.query.data, round: state.mutation.data });
    renderPage();
    const container = evidenceContainer();
    const evidence = within(container);
    expect(container).toHaveAttribute('data-source-status', 'ok');
    expect(container).toHaveAttribute('data-source-provenance', 'cached');
    expect(container).toHaveAttribute('aria-busy', 'false');
    ['Sufficient evidence', '• Round-local coverage.', 'local-round', 'Round-local evidence.', '• Round-local limitation.']
      .forEach(text => expect(evidence.getByText(text)).toBeInTheDocument());
    ['Limited evidence', 'local-budget', '• Local coverage only.', '• Local aggregate only.']
      .forEach(text => expect(evidence.queryByText(text)).not.toBeInTheDocument());
    expect(screen.getByRole('table', { name: 'local-efficiency' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic local aggregate privacy policy.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Subject privacy budget' })).toBeInTheDocument();
    expect(evidence.queryByRole('button', { name: /Refresh|Retry/ })).not.toBeInTheDocument();
    expect({ list: state.query.data, round: state.mutation.data }).toEqual(before);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('does not borrow list evidence or limitations when the winning round returns empty metadata arrays', () => {
    populate();
    state.mutation.data = {
      ...completedRound(),
      model_card: { ...card, limitations: [] },
      evidence: [],
      data_quality: { ...completedRound().data_quality, sample_count: 0, coverage_pct: null, reasons: [] },
    };
    renderPage();
    const evidence = within(evidenceContainer());
    expect(evidence.getByText('Sufficient evidence')).toBeInTheDocument();
    expect(evidence.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(evidence.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(evidence.queryByText('local-budget')).not.toBeInTheDocument();
    expect(evidence.queryByText('• Local aggregate only.')).not.toBeInTheDocument();
    expect(evidence.queryByText('• Local coverage only.')).not.toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('switches the complete metadata and trust pair away from an old-vehicle round on scope changes', () => {
    populate();
    state.mutation.data = completedRound();
    const oldRound = structuredClone(state.mutation.data);
    const view = renderPage();
    expect(within(evidenceContainer()).getByText('local-round')).toBeInTheDocument();
    state.vehicleId = 8;
    state.query = { fetchStatus: 'paused', refetch: state.retry };
    view.update();
    expect(state.read).toHaveBeenLastCalledWith(8, 12, 0);
    expect(evidenceContainer()).toHaveAttribute('data-source-status', 'initial');
    expect(evidenceContainer()).toHaveAttribute('data-source-provenance', 'unknown');
    expect(within(evidenceContainer()).getAllByText('Unknown')).toHaveLength(3);
    expect(within(evidenceContainer()).queryByText('local-round')).not.toBeInTheDocument();
    expect(within(evidenceContainer()).queryByText('• Round-local limitation.')).not.toBeInTheDocument();
    populate([{ ...card, vehicle_id: 8, limitations: ['Vehicle-eight limitation.'] }]);
    view.update();
    const evidence = within(evidenceContainer());
    expect(evidenceContainer()).toHaveAttribute('data-source-status', 'stale');
    expect(evidence.getByText('local-budget')).toBeInTheDocument();
    expect(evidence.getByText('Limited evidence')).toBeInTheDocument();
    expect(evidence.getByText('• Vehicle-eight limitation.')).toBeInTheDocument();
    expect(evidence.queryByText('local-round')).not.toBeInTheDocument();
    expect(evidence.queryByText('• Round-local coverage.')).not.toBeInTheDocument();
    expect(evidence.queryByText('• Round-local limitation.')).not.toBeInTheDocument();
    expect(state.mutation.data).toEqual(oldRound);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'fetching', source: { isLoading: true, fetchStatus: 'fetching' as const }, status: 'initial', busy: 'true' },
    { name: 'paused', source: { fetchStatus: 'paused' as const }, status: 'initial', busy: 'false' },
    { name: 'unresolved', source: { fetchStatus: 'idle' as const }, status: 'initial', busy: 'false' },
    { name: 'fatal', source: { error: new Error('Synthetic evidence source failure.') }, status: 'initialFailure', busy: 'false' },
  ])('keeps cold $name evidence unknown without authoritative empty claims or duplicate recovery', ({ source, status, busy }) => {
    Object.assign(state.query, source);
    renderPage();
    const container = evidenceContainer();
    const evidence = within(container);
    expect(container).toHaveAttribute('data-source-status', status);
    expect(container).toHaveAttribute('data-source-provenance', 'unknown');
    expect(container).toHaveAttribute('aria-busy', busy);
    if (busy === 'true') {
      ['Data quality', 'Evidence sources', 'Limitations'].forEach(label => {
        expect(evidence.getByRole('status', { name: `Loading ${label}` })).toBeInTheDocument();
      });
      expect(evidence.queryByText('Unknown')).not.toBeInTheDocument();
    } else {
      expect(evidence.getAllByText('Unknown')).toHaveLength(3);
    }
    ['Quality metadata is unsupported.', 'No supporting evidence was returned.', 'No additional limitations were returned.']
      .forEach(text => expect(evidence.queryByText(text)).not.toBeInTheDocument());
    expect(evidence.queryByRole('button', { name: /Refresh|Retry/ })).not.toBeInTheDocument();
    expect(evidence.getByText('• Raw-data or gradient upload')).toBeInTheDocument();
    expect(evidence.getByText('• A centralized fleet model or cross-subject access')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy-gated local training round' })).toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'failed refresh', source: { error: new Error('Synthetic evidence refresh failure.') }, status: 'stale', busy: 'false' },
    { name: 'paused refresh', source: { fetchStatus: 'paused' as const }, status: 'stale', busy: 'false' },
    { name: 'active refresh', source: { isFetching: true, fetchStatus: 'fetching' as const }, status: 'ok', busy: 'true' },
  ])('retains the complete list metadata pair and authentic trust during $name', ({ source, status, busy }) => {
    populate();
    Object.assign(state.query, source);
    const before = structuredClone(state.query.data);
    const view = renderPage();
    const container = evidenceContainer();
    const evidence = within(container);
    expect(container).toHaveAttribute('data-source-status', status);
    expect(container).toHaveAttribute('data-source-provenance', 'cached');
    expect(container).toHaveAttribute('aria-busy', busy);
    ['Limited evidence', '• Local coverage only.', 'local-budget', 'Subject-local evidence.', '• Local aggregate only.']
      .forEach(text => expect(evidence.getByText(text)).toBeInTheDocument());
    expect(evidence.queryByRole('button', { name: /Refresh|Retry/ })).not.toBeInTheDocument();
    if (status === 'stale') {
      const warnings = screen.getAllByTestId('stale-refresh-warning');
      expect(warnings).toHaveLength(1);
      fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
      expect(state.retry).toHaveBeenCalledOnce();
    }
    Object.assign(state.query, { error: null, isFetching: false, isLoading: false, fetchStatus: 'idle' });
    view.update();
    expect(evidenceContainer()).toHaveAttribute('data-source-status', 'ok');
    expect(within(evidenceContainer()).getByText('local-budget')).toBeInTheDocument();
    expect(state.query.data).toEqual(before);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('only claims returned-empty evidence after a list payload resolves and retains that answer on refresh failure', () => {
    const view = renderPage();
    expect(within(evidenceContainer()).getAllByText('Unknown')).toHaveLength(3);
    populate([]);
    state.query.data!.evidence = [];
    view.update();
    const evidence = within(evidenceContainer());
    expect(evidenceContainer()).toHaveAttribute('data-source-status', 'ok');
    expect(evidence.getByText('Limited evidence')).toBeInTheDocument();
    expect(evidence.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(evidence.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(screen.getByText('No local model cards exist for this vehicle and subject.')).toBeInTheDocument();
    state.query.error = new Error('Synthetic empty-list refresh failure.');
    view.update();
    expect(evidenceContainer()).toHaveAttribute('data-source-status', 'stale');
    expect(within(evidenceContainer()).getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(within(evidenceContainer()).getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });
});
