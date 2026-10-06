import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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
import type { ModelTrustReport, Prediction } from '@/types/ownership';
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
