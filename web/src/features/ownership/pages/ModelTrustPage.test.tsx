import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { Children, isValidElement } from 'react';

const chartProbe = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => ['series-primary', 'series-secondary'] }));
vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    BarChart: (props: ComponentProps<typeof actual.BarChart>) => {
      chartProbe(props);
      return <actual.BarChart {...props} width={600} height={280} />;
    },
  };
});

vi.mock('react-i18next', () => {
  const t = (key: string, second?: unknown, third?: unknown) => {
    const options = typeof second === 'object' && second != null
      ? second as Record<string, unknown>
      : typeof third === 'object' && third != null ? third as Record<string, unknown> : {};
    let text = typeof second === 'string' ? second
      : typeof options.defaultValue === 'string' ? options.defaultValue : key;
    for (const [name, value] of Object.entries(options)) {
      text = text.replace(new RegExp(`{{\\s*${name}\\s*}}`, 'g'), String(value));
    }
    return text;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership'),
  useModelTrust: vi.fn(),
  useRecordPrediction: vi.fn(),
  useRecordOutcome: vi.fn(),
}));

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useModelTrust, useRecordOutcome, useRecordPrediction } from '@/api/hooks/useOwnership';
import type { ModelScorecard, ModelTrustReport, Prediction } from '@/types/ownership';
import ModelTrustPage from './ModelTrustPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockTrust = useModelTrust as unknown as ReturnType<typeof vi.fn>;
const mockPrediction = useRecordPrediction as unknown as ReturnType<typeof vi.fn>;
const mockOutcome = useRecordOutcome as unknown as ReturnType<typeof vi.fn>;

function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 1, vehicle_id: 7, model_name: 'Unobserved cost forecast', target: 'cost_minor',
    si_unit: 'minor', predicted_at: '2026-01-01T00:00:00Z', horizon_s: 86400,
    predicted_value: 12345, predicted_low: 10000, predicted_high: 15000,
    reference: 'Recorded before the outcome', observed_value: null, observed_at: null,
    error_value: null, abs_error_pct: null, in_interval: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function report(): ModelTrustReport {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    scorecards: [], total_predictions: 2, total_scored: 1,
    trusted_count: 0, watch_count: 0, unreliable_count: 0,
    portfolio_trust_score: null,
    recent_predictions: [
      prediction(),
      prediction({
        id: 2, model_name: 'Observed zero cost', predicted_value: 0,
        predicted_low: null, predicted_high: null, observed_value: 0,
        observed_at: '2026-01-02T00:00:00Z', error_value: 0, abs_error_pct: 0,
      }),
    ],
    quality: { status: 'limited', sample_count: 2, coverage_pct: 50, window_start: null, window_end: null, reasons: [] },
    evidence: [],
  };
}

function scorecard(): ModelScorecard {
  return {
    model_name: 'Tiny SI forecast', target: 'energy_wh', si_unit: 'Wh',
    sample_count: 5, scored_count: 4, pending_count: 1, bias: -0.0000123,
    mean_abs_error: 0.0000456, root_mean_square_error: 0.0000789,
    mean_abs_pct_error: 12, median_abs_pct_error: 10, interval_coverage_pct: 65,
    skill_vs_naive_pct: -5, drift_ratio: 1.6, drift_status: 'degrading',
    trust_grade: 'watch', trust_score: 55,
    calibration: [{
      lower_pct: 0, upper_pct: 25, sample_count: 4,
      mean_abs_error: 0.0000456, mean_bias: -0.0000123, coverage_pct: 65.123456,
    }],
    narrative: 'Recorded calibration evidence, not a fresh guarantee.',
    first_scored_at: '2026-01-02T00:00:00Z', last_scored_at: '2026-02-02T00:00:00Z',
    quality: { status: 'limited', sample_count: 4, coverage_pct: 65, window_start: null, window_end: null, reasons: [] },
  };
}

function query(data: unknown) {
  return { data, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ModelTrustPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(content());
  return { ...view, rerenderPage: () => view.rerender(content()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  mockTrust.mockReturnValue(query(report()));
  mockPrediction.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockOutcome.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('ModelTrustPage financial history preservation', () => {
  it('uses the actual trust brief with unknown score, zero model counts and a retained scoring denominator', () => {
    renderPage();
    expectOperationalBand('Portfolio trust', ['portfolio', 'trusted', 'watch', 'unreliable', 'scored']);
    expect(summaryMetric('Portfolio trust', 'portfolio')).toHaveAttribute('data-value-state', 'missing');
    expect(summaryMetric('Portfolio trust', 'trusted')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Portfolio trust', 'scored')).toHaveTextContent(/1(?:\.0+)? \/ 2(?:\.0+)?/);
    fireEvent.click(within(card('Portfolio trust')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Scored / recorded');
    expect(screen.getByRole('dialog')).toHaveTextContent(/1(?:\.0+)? \/ 2(?:\.0+)?/);
    expect(mockOutcome().mutate).not.toHaveBeenCalled();
  });

  it('keeps unobserved cost pending and permits recording an outcome only for unscored predictions', () => {
    renderPage();
    const ledger = card('Prediction ledger');
    const pending = within(ledger).getByText('Unobserved cost forecast').closest('tr');
    const observed = within(ledger).getByText('Observed zero cost').closest('tr');
    expect(pending).not.toBeNull();
    expect(observed).not.toBeNull();
    expect(pending).toHaveTextContent('cost_minor · minor');
    expect(pending).toHaveTextContent(/12,345(?:\.0+)?/);
    expect(pending).toHaveTextContent(/10,000(?:\.0+)?/);
    expect(pending).toHaveTextContent(/15,000(?:\.0+)?/);
    expect(within(pending!).getByText('pending')).toBeInTheDocument();
    expect(within(pending!).getByRole('button', { name: 'Score it' })).toBeEnabled();
    expect(within(observed!).queryByRole('button', { name: 'Score it' })).not.toBeInTheDocument();
    expect(within(observed!).queryByText('pending')).not.toBeInTheDocument();
    expect(observed).toHaveTextContent(/0(?:\.0+)?%/);
    expect(within(card('Portfolio trust')).getByText('Portfolio trust score').parentElement).toHaveTextContent('—');
    expect(mockTrust).toHaveBeenCalledWith(7, 90);
    expect(mockOutcome().mutate).not.toHaveBeenCalled();
  });

  it('retains history and an edited scoring draft through a failed refresh without writing an outcome', () => {
    const data = report();
    mockTrust.mockReturnValue(query(data));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Score it' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Observed value required' }), { target: { value: '54321' } });
    const refetch = vi.fn();
    mockTrust.mockReturnValue({ ...query(data), error: new Error('history refresh failed'), refetch });
    view.rerenderPage();

    expect(screen.getByRole('spinbutton', { name: 'Observed value required' })).toHaveValue(54321);
    const ledger = card('Prediction ledger');
    expect(within(ledger).getByText('Unobserved cost forecast')).toBeInTheDocument();
    expect(within(ledger).getByText('Observed zero cost')).toBeInTheDocument();
    expect(within(ledger).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockOutcome().mutate).not.toHaveBeenCalled();
    expect(mockPrediction().mutate).not.toHaveBeenCalled();
  });

  it('keeps all source shells and an unsaved forecast reachable after initial history failure', () => {
    mockTrust.mockReturnValue({ ...query(undefined), error: new Error('history failed') });
    renderPage();
    for (const title of ['Portfolio trust', 'Model scorecards', 'Calibration by prediction magnitude', 'Prediction ledger']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(within(card('Portfolio trust')).queryByText('0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record prediction' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Model name required' }), { target: { value: 'Draft model' } });
    expect(screen.getByRole('textbox', { name: 'Model name required' })).toHaveValue('Draft model');
    expect(screen.getByRole('button', { name: 'Record forecast' })).toBeEnabled();
    expect(mockPrediction().mutate).not.toHaveBeenCalled();
  });
});

describe('ModelTrustPage scoped modernization', () => {
  it('preserves raw tiny signed calibration values and source units with the saved palette boundary', () => {
    mockTrust.mockReturnValue(query({ ...report(), scorecards: [scorecard()] }));
    renderPage();
    expect(chartProbe).toHaveBeenCalled();
    const props = chartProbe.mock.calls.at(-1)![0] as {
      data: { error: number; bias: number; coverage: number; samples: number }[];
      children: ReactNode[];
    };
    expect(props.data[0]).toMatchObject({
      error: 0.0000456, bias: -0.0000123, coverage: 65.123456, samples: 4,
    });
    expect(screen.getByText('Mean absolute error and bias per bin (Wh)')).toBeInTheDocument();
    const cards = card('Model scorecards');
    expect(within(cards).getByText('degrading')).toBeInTheDocument();
    expect(within(cards).getByText(/7\.89.*Wh/)).toBeInTheDocument();
    expect(screen.getByText('Recorded calibration evidence, not a fresh guarantee.')).toBeInTheDocument();
    const series = Children.toArray(props.children).filter(
      (child) => isValidElement<{ dataKey?: string; fill?: string }>(child) && child.props.fill != null,
    ).map((child) => isValidElement<{ dataKey?: string; fill?: string }>(child) ? {
      key: child.props.dataKey, fill: child.props.fill,
    } : null);
    expect(series).toEqual([
      { key: 'error', fill: 'series-primary' }, { key: 'bias', fill: 'series-secondary' },
    ]);
    expect(screen.getByText('Retraining or auto-correcting a model — this lab measures, it does not tune')).toBeInTheDocument();
    expect(screen.getByText('Explaining why a model drifted; it reports that it did')).toBeInTheDocument();
  });

  it('retains a forecast under its original vehicle and blocks a changed workspace until that vehicle returns', () => {
    const mutate = vi.fn();
    mockPrediction.mockReturnValue({ mutate, isPending: false });
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Record prediction' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Model name required' }), { target: { value: 'Original vehicle forecast' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Predicted value required' }), { target: { value: '0' } });
    mockSelected.mockReturnValue({ vehicleId: 8 });
    mockTrust.mockReturnValue(query({ ...report(), vehicle_id: 8, recent_predictions: [] }));
    view.rerenderPage();
    expect(screen.getByRole('textbox', { name: 'Model name required' })).toHaveValue('Original vehicle forecast');
    const submit = screen.getByRole('button', { name: 'Record forecast' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('This form belongs to 7. Return to that context to save, or cancel and open a new form.')).toBeInTheDocument();
    fireEvent.submit(submit.closest('form')!);
    expect(mutate).not.toHaveBeenCalled();
    mockSelected.mockReturnValue({ vehicleId: 7 });
    view.rerenderPage();
    expect(screen.getByRole('button', { name: 'Record forecast' })).toBeEnabled();
    fireEvent.submit(submit.closest('form')!);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 7, model_name: 'Original vehicle forecast', target: 'range_m',
      si_unit: 'm', predicted_value: 0, horizon_s: 604800,
    }), expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('retains a scoring draft and prediction identity across workspace changes and permits a measured zero', () => {
    const mutate = vi.fn();
    mockOutcome.mockReturnValue({ mutate, isPending: false });
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Score it' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Observed value required' }), { target: { value: '0' } });
    mockSelected.mockReturnValue({ vehicleId: 8 });
    mockTrust.mockReturnValue(query({ ...report(), vehicle_id: 8, recent_predictions: [] }));
    view.rerenderPage();
    const submit = screen.getByRole('button', { name: 'Score prediction' });
    expect(screen.getByRole('spinbutton', { name: 'Observed value required' })).toHaveValue(0);
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(mutate).not.toHaveBeenCalled();
    mockSelected.mockReturnValue({ vehicleId: 7 });
    view.rerenderPage();
    fireEvent.submit(submit.closest('form')!);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      prediction_id: 1, observed_value: 0, observed_at: expect.any(String),
    }), expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('keeps mutation failures and pending drafts visible without claiming a successful save', () => {
    mockPrediction.mockReturnValue({ mutate: vi.fn(), isPending: false, error: new Error('forecast rejected') });
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Record prediction' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Model name required' }), { target: { value: 'Retained forecast' } });
    expect(card('Prediction ledger')).toHaveTextContent('forecast rejected');
    expect(screen.getByRole('textbox', { name: 'Model name required' })).toHaveValue('Retained forecast');
    mockPrediction.mockReturnValue({ mutate: vi.fn(), isPending: true });
    view.rerenderPage();
    const submit = screen.getByRole('button', { name: 'Record forecast' });
    expect(submit).toBeDisabled();
    expect(within(card('Prediction ledger')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(mockPrediction().mutate).not.toHaveBeenCalled();
  });

  it('exposes every original mobile field and both calibration and scoring actions through shared details', () => {
    const dimensions = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 300, top: 0, left: 0, right: 375, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    try {
      mockTrust.mockReturnValue(query({ ...report(), scorecards: [scorecard()] }));
      renderPage();
      const cards = card('Model scorecards');
      expect(within(cards).getByRole('button', { name: 'Calibration' })).toBeEnabled();
      fireEvent.click(within(cards).getByRole('button', { name: 'Quick view' }));
      const details = screen.getByRole('dialog');
      for (const label of ['Model / target', 'Trust', 'Scored / pending', 'MAPE', 'Median APE', 'Bias', 'RMSE', 'Interval coverage', 'Skill vs naive', 'Drift', 'Actions']) {
        expect(within(details).getByText(label)).toBeInTheDocument();
      }
      expect(details).toHaveTextContent('energy_wh · Wh');
      expect(details).toHaveTextContent('degrading');
      expect(within(details).getByRole('button', { name: 'Calibration' })).toBeEnabled();
      fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
      const ledger = card('Prediction ledger');
      expect(within(ledger).getByRole('button', { name: 'Score it' })).toBeEnabled();
      fireEvent.click(within(ledger).getAllByRole('button', { name: 'Quick view' })[0]);
      const predictionDetails = screen.getByRole('dialog');
      for (const label of ['Model', 'Predicted', 'Observed', 'Error', 'In interval', 'Horizon', 'Predicted at', 'Actions']) {
        expect(within(predictionDetails).getByText(label)).toBeInTheDocument();
      }
      expect(predictionDetails).toHaveTextContent(/12,345(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent(/10,000(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent(/15,000(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent('pending');
      expect(within(predictionDetails).getByRole('button', { name: 'Score it' })).toBeEnabled();
      expect(mockOutcome().mutate).not.toHaveBeenCalled();
    } finally {
      dimensions.mockRestore();
    }
  });
});
