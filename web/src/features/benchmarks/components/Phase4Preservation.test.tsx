import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { BenchmarkMetric, BenchmarkPrivacyStatus, BenchmarkRelease } from '@/api/hooks/useBenchmarks';
import { deriveDataState } from '@/api/dataState';
import { ConsentGate } from './ConsentGate';
import { PrivacyBudgetPanel } from './PrivacyBudgetPanel';
import { PrivacyControls } from './PrivacyControls';
import { MetricComparisonGrid } from './MetricComparisonGrid';
import { BenchmarkPercentileChart } from './BenchmarkPercentileChart';
import { MethodologyPanel } from './MethodologyPanel';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => String(value),
    fmtInt: (value: number) => String(value),
    fmtPercent: (value: number) => `${value}%`,
    fmtScientificNumber: (value: number) => String(value),
  }),
}));

const status: BenchmarkPrivacyStatus = {
  vehicle_id: 7, opted_in: true, opted_in_at: '2026-07-01T00:00:00Z',
  revoked_at: null, epsilon_budget: 4, epsilon_spent: 0,
  epsilon_remaining: 4, minimum_cohort_size: 5, mechanism_version: 1,
};
const metric: BenchmarkMetric = {
  metric_name: 'degradation_pct', unit: 'pct', lower_bound: 0, upper_bound: 100,
  epsilon_spent: 0.25, noisy_cohort_size: 8, noisy_mean: 5, noisy_p25: 2,
  noisy_p75: 8, noise_scale: 1, suppressed: false, quality: 'moderate',
  target_value: 0, percentile: 100, higher_is_better: false,
};
const release: BenchmarkRelease = {
  release_id: 42, period_start: '2026-04-01', period_end: '2026-07-01',
  model_family: 'model_3', model_year_bucket: 2020, mechanism_version: 1,
  minimum_cohort_size: 5, epsilon_spent: 1, suppressed: false,
  suppression_reason: null, created_at: '2026-07-02T00:00:00Z',
  metrics: [metric, {
    ...metric, metric_name: 'operation_reliability_pct', target_value: null,
    percentile: null, suppressed: true, quality: 'suppressed', higher_is_better: true,
  }],
};

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
  );
}

describe('phase 4 private benchmark presentation preservation', () => {
  it('keeps the zero target, suppressed unknown, noisy IQR, quality and performance direction', () => {
    const before = JSON.stringify(release);
    const { container } = show(<>
      <MetricComparisonGrid release={release} />
      <BenchmarkPercentileChart release={release} />
    </>);
    expect(screen.getByText(/Private IQR/)).toBeInTheDocument();
    expect(screen.getByText('Suppressed below privacy threshold')).toBeInTheDocument();
    expect(screen.getByText('Percentile unavailable')).toBeInTheDocument();
    expect(screen.getByText('100th performance percentile')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText((text, element) =>
      text === 'Higher bars mean better relative performance'
      && element?.getAttribute('data-card-desc') === 'true',
    )).toBeVisible();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Degradation');
    expect(table).toHaveTextContent('100');
    expect(table).not.toHaveTextContent('Operations');
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(JSON.stringify(release)).toBe(before);
  });

  it('retains a real zero-spend status on failed refresh and retries its original source', () => {
    const retry = vi.fn();
    const source = deriveDataState({ data: status, error: new Error('refresh failed'), refetch: retry });
    show(<PrivacyBudgetPanel status={status} source={source} />);
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toBeInTheDocument();
    expect(screen.getByText('ε 4 remaining')).toHaveTextContent('4');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('a missing status never enables consent or reports a measured zero budget', () => {
    const source = deriveDataState<BenchmarkPrivacyStatus>({
      error: new Error('status failed'), refetch: vi.fn(),
    });
    const consent = vi.fn();
    const { container } = show(<>
      <ConsentGate optedIn={false} acknowledged pending={false} error={null}
        onAcknowledgedChange={vi.fn()} onConsent={consent} source={source} />
      <PrivacyBudgetPanel status={null} source={source} />
    </>);
    expect(screen.queryByRole('button', { name: 'Opt in' })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 remaining/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(consent).not.toHaveBeenCalled();
  });

  it('keeps every methodology step in order and the non-causal representativeness limit', () => {
    show(<MethodologyPanel />);
    const list = screen.getByRole('list', { name: 'Methodology & limits' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('clips every vehicle');
    expect(rows[1]).toHaveTextContent('five-year model-year buckets');
    expect(rows[2]).toHaveTextContent('Laplace noise');
    expect(rows[3]).toHaveTextContent('release ID is reused');
    expect(screen.getByText(/suitable for causal conclusions/)).toBeInTheDocument();
  });

  it('revocation still requires exact typed confirmation and preserves the disclosure', () => {
    const revoke = vi.fn();
    show(<PrivacyControls optedIn pending={false} error={null} onRevoke={revoke} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke & delete contribution data' }));
    const confirm = screen.getByRole('button', { name: 'Revoke & delete' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/Published noisy cohort releases cannot be withdrawn/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Type REVOKE to confirm' }), { target: { value: 'revoke' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Type REVOKE to confirm' }), { target: { value: 'REVOKE' } });
    fireEvent.click(confirm);
    expect(revoke).toHaveBeenCalledOnce();
  });
});
