import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { APICallLogStats } from '@/api/types';
import { ApiLogsSummary } from './ApiLogsSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match) }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));

const snapshot: APICallLogStats = Object.freeze({
  total_calls: 1234, error_rate: 6.5, error_count: 80, avg_duration_ms: 145.9, last_24h: 56,
  by_method: {}, by_service: {},
});
const range = { start: '2026-10-01T00:00:00Z', endExclusive: '2026-10-02T00:00:00Z', timezone: 'UTC' };
afterEach(cleanup);

describe('API log summary canonical preservation', () => {
  it('keeps four numeric tiles, the negative error-count trend and integer millisecond presentation', () => {
    const state = deriveDataState({ data: snapshot, dataUpdatedAt: 1000 });
    const { container } = render(<MemoryRouter><ApiLogsSummary {...range} state={state} loading={false} allTime={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="api-average-duration"] [data-operational-value]')).toHaveTextContent('146 ms');
    expect(container.querySelector('[data-operational-metric="api-error-rate"]')).toHaveTextContent('80');
    expect(container.querySelector('[data-operational-metric="api-error-rate"]')).toHaveTextContent('increased');
    expect(snapshot.avg_duration_ms).toBe(145.9);
    expect(screen.getByTestId('api-logs-range-summary')).toHaveAttribute('data-operational-brief');
    expect(screen.getByTestId('api-logs-range-summary')).toHaveTextContent('2026-10-01T00:00:00Z');
    expect(screen.getByTestId('api-logs-24h-summary')).toHaveTextContent('does not record its exact bounds');
  });

  it('attests all-time separately from the fixed 24-hour count and retains both after refresh failure', () => {
    const state = deriveDataState({ data: snapshot, error: new Error('stats refresh failed'), isFetching: true });
    render(<MemoryRouter><ApiLogsSummary {...range} state={state} loading={false} allTime /></MemoryRouter>);
    const total = screen.getByTestId('api-logs-range-summary');
    const rolling = screen.getByTestId('api-logs-24h-summary');
    expect(total).toHaveTextContent('All time');
    expect(total).toHaveTextContent('Refreshing source');
    expect(total).toHaveTextContent('1,234');
    expect(screen.getByRole('alert')).toHaveTextContent('stats refresh failed');
    expect(rolling).toHaveTextContent('Refreshing source');
    expect(rolling).toHaveTextContent('56');
    expect(rolling).toHaveTextContent('not the View settings range');
  });

  it('preserves fixed integer milliseconds above one second instead of adapting to seconds', () => {
    const state = deriveDataState({ data: { ...snapshot, avg_duration_ms: 1499.9 } });
    const { container } = render(<MemoryRouter><ApiLogsSummary {...range} state={state} loading={false} allTime={false} /></MemoryRouter>);
    const latency = container.querySelector('[data-operational-metric="api-average-duration"]');
    expect(latency?.querySelector('[data-operational-value]')).toHaveTextContent('1,500 ms');
  });

  it('preserves labelled shells and never displays zero during the first load or initial failure', () => {
    const pending = deriveDataState<APICallLogStats>({ isLoading: true });
    const { container, rerender } = render(<MemoryRouter><ApiLogsSummary {...range}
      state={pending} loading allTime={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByTestId('api-logs-range-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Total calls')[0]).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    const failed = deriveDataState<APICallLogStats>({ error: new Error('stats unavailable') });
    rerender(<MemoryRouter><ApiLogsSummary {...range} state={failed} loading={false} allTime={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(screen.getByRole('alert')).toHaveTextContent('stats unavailable');
  });
  it('opens the real review details drawer without replacing the request workspace', () => {
    const state = deriveDataState({ data: snapshot });
    render(<MemoryRouter><ApiLogsSummary {...range} state={state} loading={false} allTime={false} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('api-logs-24h-summary')).toBeInTheDocument();
  });
});
