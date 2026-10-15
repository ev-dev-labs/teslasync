import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { Children, isValidElement } from 'react';

const chartProbe = vi.hoisted(() => vi.fn());
const datePreferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone_user: 'UTC',
  tz_display_default: 'user' as 'user' | 'vehicle' | 'utc',
}));
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: datePreferences.locale,
        settings: { ...result.settings, ...datePreferences },
      };
    },
  };
});
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
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { MockResizeObserver } from '@/test/setup';
import { formatDateTime } from '@/lib/dateFormat';
import { formatPct } from '../formatters';
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
  Object.assign(datePreferences, { locale: 'en-US', timezone_user: 'UTC', tz_display_default: 'user' });
  mockSelected.mockReturnValue({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  mockTrust.mockReturnValue(query(report()));
  mockPrediction.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockOutcome.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('ModelTrustPage financial history preservation', () => {
  it('updates page and brief dates with display preferences without rewriting raw instants or implying source freshness', () => {
    const data = report();
    const predictions = data.recent_predictions ?? [];
    const model = scorecard();
    model.quality = {
      ...model.quality!,
      window_start: '2026-01-02T00:30:00Z',
      window_end: '2026-02-02T00:30:00Z',
    };
    data.scorecards = [model];
    const original = structuredClone(data);
    const loadedAt = Date.parse('2026-03-02T02:30:00Z');
    mockTrust.mockReturnValue({ ...query(data), dataUpdatedAt: loadedAt });
    Object.assign(datePreferences, { locale: 'de-DE', timezone_user: 'America/Los_Angeles' });
    const view = renderPage();
    fireEvent.click(within(card('Prediction ledger')).getByRole('button', { name: 'Score it' }));

    const assertDates = (locale: string, tz: string) => {
      const format = (value: string | Date | null | undefined) => formatDateTime(value, { locale, tz });
      const ledger = card('Prediction ledger');
      const rows = within(ledger).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent(format(predictions[0].predicted_at));
      expect(rows[1]).toHaveTextContent(format(predictions[1].observed_at));
      expect(document.getElementById('model-trust-scoring-context')).toHaveTextContent(
        `Predicted at: ${format(predictions[0].predicted_at)}`,
      );
      const calibration = card('Calibration by prediction magnitude');
      expect(within(calibration).getByRole('region', { name: 'Data quality' })).toHaveTextContent(
        `${format(model.quality!.window_start)} – ${format(model.quality!.window_end)}`,
      );
      expect(calibration).toHaveTextContent(`First scored ${format(model.first_scored_at)}`);
      expect(calibration).toHaveTextContent(`Last scored ${format(model.last_scored_at)}`);
      const brief = card('Portfolio trust');
      expect(brief).toHaveTextContent(tz);
      expect(brief).toHaveTextContent(`Recorded bounds ${format(data.window.from)} → ${format(data.window.to)}`);
      expect(brief).toHaveTextContent(`Client loaded ${format(new Date(loadedAt))}`);
      expect(brief).toHaveTextContent('Source freshness unknown');
      expect(brief).not.toHaveTextContent('Source as of');
    };

    assertDates('de-DE', 'America/Los_Angeles');
    Object.assign(datePreferences, { locale: 'en-GB', tz_display_default: 'vehicle' });
    mockSelected.mockReturnValue({
      vehicleId: 7, vehicle: { id: 7, timezone: 'Asia/Tokyo' }, vehicles: [], setVehicleId: vi.fn(),
    });
    view.rerenderPage();
    assertDates('en-GB', 'Asia/Tokyo');
    datePreferences.tz_display_default = 'utc';
    view.rerenderPage();
    assertDates('en-GB', 'UTC');
    expect(data).toEqual(original);
    expect(mockPrediction().mutate).not.toHaveBeenCalled();
    expect(mockOutcome().mutate).not.toHaveBeenCalled();
  });

  it('retains row references, signed SI source errors and distinct absolute percentage errors in source order', () => {
    const rows = [
      prediction({ id: 11, model_name: 'Negative error', reference: 'Negative source reference', error_value: -1.125, abs_error_pct: 12.5 }),
      prediction({ id: 12, model_name: 'Positive fractional error', reference: 'Fractional source reference', error_value: 0.125, abs_error_pct: 3.5 }),
      prediction({ id: 13, model_name: 'Measured zero', reference: '', error_value: 0, abs_error_pct: 0, observed_value: 0 }),
      prediction({ id: 14, model_name: 'Missing error', error_value: null, abs_error_pct: null }),
    ];
    mockTrust.mockReturnValue(query({ ...report(), recent_predictions: rows }));
    renderPage();
    const ledger = card('Prediction ledger');
    const headings = within(ledger).getAllByRole('columnheader').map(header => header.textContent);
    const cell = (row: HTMLElement, heading: string) =>
      within(row).getAllByRole('cell')[headings.findIndex(text => text?.includes(heading))];
    const renderedRows = within(ledger).getAllByRole('row').slice(1);
    expect(renderedRows).toHaveLength(rows.length);
    rows.forEach((source, index) => expect(renderedRows[index]).toHaveTextContent(source.model_name));
    expect(cell(renderedRows[0], 'Reference')).toHaveTextContent('Negative source reference');
    expect(cell(renderedRows[0], 'Signed source error')).toHaveTextContent('-1.125 minor');
    expect(cell(renderedRows[1], 'Reference')).toHaveTextContent('Fractional source reference');
    expect(cell(renderedRows[1], 'Signed source error')).toHaveTextContent('+0.125 minor');
    expect(cell(renderedRows[0], 'Error')).toHaveTextContent(/12\.5(?:0+)?%/);
    expect(cell(renderedRows[1], 'Error')).toHaveTextContent(/3\.5(?:0+)?%/);
    expect(cell(renderedRows[2], 'Reference')).toHaveTextContent('—');
    expect(cell(renderedRows[2], 'Signed source error')).toHaveTextContent(/^0(?:\.0+)? minor$/);
    expect(cell(renderedRows[2], 'Error')).toHaveTextContent(/^0(?:\.0+)?%$/);
    expect(cell(renderedRows[3], 'Signed source error')).toHaveTextContent('—');
    expect(cell(renderedRows[3], 'Error')).toHaveTextContent('—');
    expect(within(renderedRows[2]).queryByRole('button', { name: 'Score it' })).not.toBeInTheDocument();
    expect(within(renderedRows[3]).getByRole('button', { name: 'Score it' })).toBeEnabled();
  });

  it.each([undefined, NaN, Infinity, -Infinity, '', '0', 'invalid', false])(
    'does not present invalid source or percentage errors (%s) as measured zero',
    (value) => {
      mockTrust.mockReturnValue(query({
        ...report(),
        recent_predictions: [{ ...prediction(), error_value: value, abs_error_pct: value }],
      }));
      renderPage();
      const row = within(card('Prediction ledger')).getByText('Unobserved cost forecast').closest('tr')!;
      expect(within(row).getAllByRole('cell').filter(cell => cell.textContent === '—')).toHaveLength(3);
      expect(within(row).getByRole('button', { name: 'Score it' })).toBeEnabled();
      expect(row).not.toHaveTextContent(/NaN|Infinity|invalid|0(?:\.0+)? minor|0(?:\.0+)?%/);
    },
  );

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
  it.each([65.123456, 0, null, undefined, NaN, Infinity])(
    'labels bin coverage (%s) as a percent or unknown without changing raw chart values',
    (coverage) => {
      const model = scorecard();
      mockTrust.mockReturnValue(query({
        ...report(),
        scorecards: [{ ...model, calibration: [{ ...model.calibration[0], coverage_pct: coverage }] }],
      }));
      renderPage();
      const calibration = card('Calibration by prediction magnitude');
      const table = within(calibration).getByRole('table');
      const headers = within(table).getAllByRole('columnheader');
      const coverageIndex = headers.findIndex(header => header.textContent === 'Coverage');
      expect(coverageIndex).toBeGreaterThanOrEqual(0);
      const cell = within(table).getAllByRole('row')[1].querySelectorAll('td')[coverageIndex];
      expect(cell.textContent).toBe(typeof coverage === 'number' && Number.isFinite(coverage)
        ? formatPct(coverage) : '—');
      expect(chartProbe.mock.calls.at(-1)![0].data[0]).toMatchObject({
        error: model.calibration![0].mean_abs_error,
        bias: model.calibration![0].mean_bias,
        coverage,
        samples: 4,
      });
    },
  );

  it('shows the selected model quality, window and reasons separately from portfolio evidence', () => {
    const first = {
      ...scorecard(),
      quality: {
        status: 'limited' as const, sample_count: 4, coverage_pct: 65,
        window_start: '2026-01-02T00:00:00Z', window_end: '2026-02-02T00:00:00Z',
        reasons: ['Only four scored model outcomes'],
      },
    };
    const second = {
      ...scorecard(), model_name: 'Other model',
      quality: {
        status: 'insufficient' as const, sample_count: 0, coverage_pct: null,
        window_start: null, window_end: null, reasons: ['No scored outcomes for this model'],
      },
    };
    mockTrust.mockReturnValue(query({
      ...report(), scorecards: [first, second],
      quality: { ...report().quality, reasons: ['Portfolio-only quality reason'] },
      evidence: [{ source: 'Portfolio ledger', summary: 'Portfolio-only source', sample_count: 2, observed_at: null }],
    }));
    renderPage();
    const calibration = card('Calibration by prediction magnitude');
    const quality = within(calibration).getByRole('region', { name: 'Data quality' });
    expect(quality).toHaveTextContent('limited');
    expect(quality).toHaveTextContent(/Coverage65(?:\.0+)?%/);
    expect(quality).toHaveTextContent('Observation window');
    expect(quality).toHaveTextContent(`${formatDateTime(first.quality.window_start, { locale: 'en-US', tz: 'UTC' })} – ${formatDateTime(first.quality.window_end, { locale: 'en-US', tz: 'UTC' })}`);
    expect(quality).toHaveTextContent('Only four scored model outcomes');
    expect(quality).not.toHaveTextContent('Portfolio-only');
    const evidence = card('Evidence, quality, and limitations');
    expect(evidence).toHaveTextContent('Portfolio-only quality reason');
    expect(evidence).toHaveTextContent('Portfolio-only source');
    expect(evidence).not.toHaveTextContent('Only four scored model outcomes');
    fireEvent.click(within(card('Model scorecards')).getAllByRole('button', { name: 'Calibration' })[1]);
    expect(quality).toHaveTextContent('insufficient');
    expect(quality).toHaveTextContent('Coverage—');
    expect(quality).toHaveTextContent('Observation window—');
    expect(quality).toHaveTextContent('No scored outcomes for this model');
    expect(quality).not.toHaveTextContent('Only four scored model outcomes');
    expect(evidence).toHaveTextContent('Portfolio-only source');
  });

  it.each([
    { target: 'cost_minor', si_unit: 'minor', predicted_value: 12345, observed_value: 12346 },
    { target: 'range_m', si_unit: 'm', predicted_value: 1609.344, observed_value: 1800.125 },
  ])('keeps immutable $target scoring context and submits the raw observation after history changes', (values) => {
    const mutate = vi.fn();
    mockOutcome.mockReturnValue({ mutate, isPending: false });
    const original = prediction({
      target: values.target, si_unit: values.si_unit, predicted_value: values.predicted_value,
    });
    const data = { ...report(), recent_predictions: [original] };
    mockTrust.mockReturnValue(query(data));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Score it' }));
    const input = screen.getByRole('spinbutton', { name: 'Observed value required' });
    const form = input.closest('form')!;
    expect(form).toHaveTextContent('Model: Unobserved cost forecast');
    expect(form).toHaveTextContent(`Target quantity: ${values.target}`);
    expect(form).toHaveTextContent(`SI unit: ${values.si_unit}`);
    expect(form).toHaveTextContent(`Predicted #1: ${values.predicted_value} ${values.si_unit}`);
    expect(form).toHaveTextContent('Reference: Recorded before the outcome');
    expect(input).toHaveAccessibleDescription(/Recorded before the outcome/);
    expect(input).toHaveValue(values.predicted_value);
    expect(form.textContent).not.toMatch(/USD|EUR|GBP|\$/);
    fireEvent.change(input, { target: { value: String(values.observed_value) } });

    // Even an in-place cache update must not rewrite the context of an open form.
    Object.assign(original, {
      id: 99, vehicle_id: 8, model_name: 'Replacement model', target: 'energy_wh',
      si_unit: 'Wh', reference: 'Replacement reference', predicted_value: 999,
    });
    mockTrust.mockReturnValue(query(data));
    view.rerenderPage();
    expect(form).toHaveTextContent('Model: Unobserved cost forecast');
    expect(form).toHaveTextContent(`Target quantity: ${values.target}`);
    expect(form).toHaveTextContent(`SI unit: ${values.si_unit}`);
    expect(form).toHaveTextContent(`Predicted #1: ${values.predicted_value} ${values.si_unit}`);
    expect(form).toHaveTextContent('Reference: Recorded before the outcome');
    expect(form).not.toHaveTextContent('Replacement');
    mockTrust.mockReturnValue(query({ ...data, recent_predictions: [] }));
    view.rerenderPage();
    expect(input).toHaveValue(values.observed_value);
    expect(within(form).getByRole('button', { name: 'Score prediction' })).toBeEnabled();
    fireEvent.submit(form);
    expect(mutate).toHaveBeenCalledWith({
      prediction_id: 1, observed_value: values.observed_value, observed_at: expect.any(String),
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('shows a missing reference explicitly without inventing scoring metadata', () => {
    mockTrust.mockReturnValue(query({
      ...report(), recent_predictions: [prediction({ reference: '' })],
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Score it' }));
    const form = screen.getByRole('spinbutton', { name: 'Observed value required' }).closest('form')!;
    expect(form).toHaveTextContent('Reference: —');
    expect(form).toHaveTextContent('SI unit: minor');
    expect(mockOutcome().mutate).not.toHaveBeenCalled();
  });

  it('preserves raw tiny signed calibration values and source units with the saved palette boundary', () => {
    const preferences = getFormatterPreferences();
    // The supported formatter uses saved fixed-decimal precision, not exponent notation.
    setGlobalLocale('en-US');
    setGlobalPrecision(7);
    try {
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
      expect(within(cards).getByText('0.0000789 Wh')).toBeInTheDocument();
      expect(within(cards).getByText('-0.0000123 Wh')).toBeInTheDocument();
      expect(screen.getByText('Recorded calibration evidence, not a fresh guarantee.')).toBeInTheDocument();
      const series = Children.toArray(props.children).filter(
        (child) => isValidElement<{ dataKey?: string; fill?: string }>(child) && child.props.fill != null,
      ).map((child) => isValidElement<{ dataKey?: string; fill?: string }>(child) ? {
        key: child.props.dataKey, fill: child.props.fill,
      } : null);
      expect(series).toEqual([
        { key: 'error', fill: 'series-primary' }, { key: 'bias', fill: 'series-secondary' },
      ]);
      expect(screen.getByText('• Retraining or auto-correcting a model — this lab measures, it does not tune')).toBeInTheDocument();
      expect(screen.getByText('• Explaining why a model drifted; it reports that it did')).toBeInTheDocument();
    } finally {
      act(() => {
        setGlobalPrecision(preferences.precision);
        setGlobalLocale(preferences.locale);
      });
    }
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

  describe.each([
    {
      kind: 'forecast',
      hook: mockPrediction,
      open: 'Record prediction',
      submit: 'Record forecast',
      field: 'Model name required',
      role: 'textbox',
      value: 'Submitted forecast',
      payload: { vehicle_id: 7, model_name: 'Submitted forecast' },
    },
    {
      kind: 'outcome',
      hook: mockOutcome,
      open: 'Score it',
      submit: 'Score prediction',
      field: 'Observed value required',
      role: 'spinbutton',
      value: 54321,
      payload: { prediction_id: 1, observed_value: 54321 },
    },
  ])('$kind submission lifecycle', ({ hook, open, submit, field, role, value, payload }) => {
    it('freezes all submitted fields across scope changes, retains rejection and closes only on matching success', () => {
      const mutate = vi.fn<(body: unknown, options: { onSuccess: () => void }) => void>();
      hook.mockReturnValue({ mutate, isPending: false });
      const view = renderPage();
      fireEvent.click(screen.getByRole('button', { name: open }));
      fireEvent.change(screen.getByRole(role, { name: field }), { target: { value: String(value) } });
      const form = screen.getByRole('button', { name: submit }).closest('form')!;
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledOnce();
      expect(mutate.mock.calls[0][0]).toMatchObject(payload);

      hook.mockReturnValue({ mutate, isPending: true });
      view.rerenderPage();
      const fields = [
        ...within(form).queryAllByRole('textbox'),
        ...within(form).queryAllByRole('spinbutton'),
        ...within(form).queryAllByRole('combobox'),
      ];
      expect(fields).toHaveLength(open === 'Record prediction' ? 8 : 1);
      fields.forEach(control => expect(control).toBeDisabled());
      expect(screen.getByRole(role, { name: field })).toHaveValue(value);
      expect(within(form).getByRole('button', { name: submit })).toBeDisabled();
      fireEvent.click(within(card('Prediction ledger')).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole(role, { name: field })).toHaveValue(value);

      mockSelected.mockReturnValue({ vehicleId: 8 });
      mockTrust.mockReturnValue(query({
        ...report(), vehicle_id: 8,
        recent_predictions: [prediction({ id: 99, vehicle_id: 8, model_name: 'Different prediction' })],
      }));
      view.rerenderPage();
      fields.forEach(control => expect(control).toBeDisabled());
      expect(screen.getByRole(role, { name: field })).toHaveValue(value);
      expect(screen.getByText('This form belongs to 7. Return to that context to save, or cancel and open a new form.')).toBeInTheDocument();
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledOnce();
      expect(mutate.mock.calls[0][0]).toMatchObject(payload);

      hook.mockReturnValue({ mutate, isPending: false, error: new Error('submission rejected') });
      view.rerenderPage();
      expect(card('Prediction ledger')).toHaveTextContent('submission rejected');
      expect(screen.getByRole(role, { name: field })).toHaveValue(value);
      expect(screen.getByRole(role, { name: field })).toBeEnabled();
      expect(screen.getByRole('button', { name: submit })).toBeDisabled();

      mockSelected.mockReturnValue({ vehicleId: 7 });
      view.rerenderPage();
      expect(screen.getByRole('button', { name: submit })).toBeEnabled();
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1][0]).toMatchObject(payload);
      hook.mockReturnValue({ mutate, isPending: true });
      view.rerenderPage();
      act(() => mutate.mock.calls[1][1].onSuccess());
      expect(screen.queryByRole(role, { name: field })).not.toBeInTheDocument();
    });

    it('does not let a stale successful completion close a newer draft', () => {
      const mutate = vi.fn<(body: unknown, options: { onSuccess: () => void }) => void>();
      hook.mockReturnValue({ mutate, isPending: false });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: open }));
      fireEvent.change(screen.getByRole(role, { name: field }), { target: { value: String(value) } });
      fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
      const staleSuccess = mutate.mock.calls[0][1].onSuccess;
      act(() => staleSuccess());
      expect(screen.queryByRole(role, { name: field })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: open }));
      const newerValue = role === 'textbox' ? 'New unsent forecast' : 67890;
      fireEvent.change(screen.getByRole(role, { name: field }), { target: { value: String(newerValue) } });
      act(() => staleSuccess());
      expect(screen.getByRole(role, { name: field })).toHaveValue(newerValue);
      expect(screen.getByRole('button', { name: submit })).toBeEnabled();
      expect(mutate).toHaveBeenCalledOnce();
    });

    it('settles the captured submission successfully even if the workspace changes while pending', () => {
      const mutate = vi.fn<(body: unknown, options: { onSuccess: () => void }) => void>();
      hook.mockReturnValue({ mutate, isPending: false });
      const view = renderPage();
      fireEvent.click(screen.getByRole('button', { name: open }));
      fireEvent.change(screen.getByRole(role, { name: field }), { target: { value: String(value) } });
      fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
      hook.mockReturnValue({ mutate, isPending: true });
      mockSelected.mockReturnValue({ vehicleId: 8 });
      mockTrust.mockReturnValue(query({ ...report(), vehicle_id: 8, recent_predictions: [] }));
      view.rerenderPage();
      expect(screen.getByRole(role, { name: field })).toHaveValue(value);
      expect(screen.getByRole(role, { name: field })).toBeDisabled();
      expect(mutate.mock.calls[0][0]).toMatchObject(payload);
      act(() => mutate.mock.calls[0][1].onSuccess());
      expect(screen.queryByRole(role, { name: field })).not.toBeInTheDocument();
      expect(mutate).toHaveBeenCalledOnce();
    });
  });

  it('exposes every original mobile field and both calibration and scoring actions through shared details', async () => {
    let allocatedWidth = 0;
    const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const dimensions = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute('data-grid-frame')) return getBoundingClientRect.call(this);
      return {
        width: allocatedWidth, height: 300, top: 0, left: 0, right: allocatedWidth,
        bottom: 300, x: 0, y: 0, toJSON: () => ({}),
      };
    });
    const resizeObserver = globalThis.ResizeObserver;
    const observers = new Set<MockResizeObserver>();
    // Deliver allocated-width changes after mounting, as a browser observer would.
    vi.stubGlobal('ResizeObserver', class extends MockResizeObserver {
      override observe(target: Element) {
        super.observe(target);
        observers.add(this);
      }
    });
    try {
      const defaultCard = {
        ...scorecard(),
        model_name: 'Default calibration forecast',
        calibration: [{
          ...scorecard().calibration[0], mean_abs_error: 0.5, mean_bias: 0.25,
        }],
      };
      mockTrust.mockReturnValue(query({
        ...report(),
        scorecards: [defaultCard, scorecard()],
        recent_predictions: [
          prediction({ error_value: -0.125, abs_error_pct: 3.5 }),
          report().recent_predictions[1],
        ],
      }));
      await act(async () => { renderPage(); });
      const frames = [
        card('Model scorecards').querySelector('[data-grid-frame]')!,
        card('Prediction ledger').querySelector('[data-grid-frame]')!,
      ];
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        expect(frame).toBeInTheDocument();
        expect([...observers].some(observer => observer.observed.has(frame))).toBe(true);
        expect(frame.querySelector('[data-mobile-table]')).toBeNull();
      }
      allocatedWidth = 375;
      await act(async () => {
        for (const observer of observers) {
          for (const target of observer.observed) {
            if (frames.includes(target)) observer.trigger(target);
          }
        }
      });
      for (const frame of frames) {
        expect(frame.getBoundingClientRect().width).toBe(375);
        expect(frame.querySelectorAll('[data-mobile-table]')).toHaveLength(1);
        expect(frame.querySelector('table')).toBeNull();
      }
      const cards = card('Model scorecards');
      expect(chartProbe.mock.calls.at(-1)![0].data[0]).toMatchObject({ error: 0.5, bias: 0.25 });
      expect(within(cards).getAllByRole('button', { name: 'Calibration' })[1]).toBeEnabled();
      fireEvent.click(within(cards).getAllByRole('button', { name: 'Quick view' })[1]);
      const details = screen.getByRole('dialog');
      for (const label of ['Model / target', 'Trust', 'Scored / pending', 'MAPE', 'Median APE', 'Bias', 'RMSE', 'Interval coverage', 'Skill vs naive', 'Drift', 'Actions']) {
        expect(within(details).getByText(label)).toBeInTheDocument();
      }
      expect(details).toHaveTextContent('energy_wh · Wh');
      expect(details).toHaveTextContent('degrading');
      expect(within(details).getByRole('button', { name: 'Calibration' })).toBeEnabled();
      fireEvent.click(within(details).getByRole('button', { name: 'Calibration' }));
      expect(chartProbe.mock.calls.at(-1)![0].data[0]).toMatchObject({
        error: 0.0000456, bias: -0.0000123, coverage: 65.123456, samples: 4,
      });
      fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
      const ledger = card('Prediction ledger');
      expect(within(ledger).getByRole('button', { name: 'Score it' })).toBeEnabled();
      fireEvent.click(within(ledger).getAllByRole('button', { name: 'Quick view' })[0]);
      const predictionDetails = screen.getByRole('dialog');
      for (const label of ['Model', 'Predicted', 'Observed', 'Reference', 'Signed source error', 'Error', 'In interval', 'Horizon', 'Predicted at', 'Actions']) {
        expect(within(predictionDetails).getByText(label)).toBeInTheDocument();
      }
      expect(predictionDetails).toHaveTextContent(/12,345(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent(/10,000(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent(/15,000(?:\.0+)?/);
      expect(predictionDetails).toHaveTextContent('pending');
      expect(predictionDetails).toHaveTextContent('Recorded before the outcome');
      expect(predictionDetails).toHaveTextContent('-0.125 minor');
      expect(predictionDetails).toHaveTextContent(/3\.5(?:0+)?%/);
      expect(within(predictionDetails).getByRole('button', { name: 'Score it' })).toBeEnabled();
      fireEvent.click(within(predictionDetails).getByRole('button', { name: 'Score it' }));
      fireEvent.click(within(predictionDetails).getByRole('button', { name: 'Close' }));
      expect(screen.getByRole('spinbutton', { name: 'Observed value required' })).toHaveValue(12345);
      expect(screen.getByRole('button', { name: 'Score prediction' })).toBeEnabled();
      expect(mockOutcome().mutate).not.toHaveBeenCalled();
    } finally {
      dimensions.mockRestore();
      vi.stubGlobal('ResizeObserver', resizeObserver);
    }
  });
});
