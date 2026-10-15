import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { BillVarianceReport } from '@/types/charging';
import { BillVarianceCard } from './BillVarianceCard';
import { bill } from './fixtures.test-utils';

const source = vi.hoisted(() => ({
  query: {} as DataStateSource<BillVarianceReport>,
  retry: vi.fn(),
  useBillVariance: vi.fn(),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useBillVariance: (vehicleId?: number) => {
    source.useBillVariance(vehicleId);
    return source.query;
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('./useStatFormatting', () => ({
  useStatFormatting: () => ({
    text: (_id: string, value: number | undefined) => value == null ? 'Unknown' : String(value),
    preferences: { currency: { kind: 'symbol', value: '$' },
      units: { energy: 'Wh', distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
        duration: 'h', power: 'W' } },
  }),
}));

const windowCopy = 'Reconciliation is independent of the selected date range; its reporting window is not supplied by this view.';
function show() {
  return render(<BillVarianceCard vehicleId={7} />, { wrapper: MemoryRouter });
}
function metric(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll('[data-operational-metric]'))
    .find(item => item.textContent?.includes(label));
  expect(found).toBeDefined();
  return found!;
}
beforeEach(() => {
  vi.clearAllMocks();
  source.query = { data: bill, isLoading: false, isPending: false, isFetching: false,
    isError: false, isSuccess: true, fetchStatus: 'idle', error: null, refetch: source.retry };
});
afterEach(cleanup);

describe('independent billing data trust', () => {
  it('shows a skeleton only during active initial loading, not a paused load', () => {
    source.query = { ...source.query, data: undefined, isSuccess: false, isPending: true,
      isLoading: true, isFetching: true, fetchStatus: 'fetching' };
    const { container, rerender } = show();
    expect(screen.queryByText('No reconciliation data yet')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(container.querySelector('[aria-hidden="true"][style]')).not.toBeNull();
    expect(screen.getAllByText(windowCopy).length).toBeGreaterThan(0);

    source.query = { ...source.query, isLoading: false, isFetching: false, fetchStatus: 'paused' };
    rerender(<BillVarianceCard vehicleId={7} />);
    expect(container.querySelector('[aria-hidden="true"][style]')).toBeNull();
    expect(screen.getByText('No reconciliation data yet')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.retry).toHaveBeenCalledOnce();
  });

  it('keeps successful empty responses distinct from measured zero', () => {
    source.query = { ...source.query, data: undefined };
    const { container, rerender } = show();
    expect(screen.getByText('No reconciliation data yet')).toBeInTheDocument();
    source.query = { ...source.query, data: { ...bill, measured_sessions: 0, invoiced_sessions: 0,
      energy_delta_wh: 0, energy_delta_pct: 0, cost_delta: 0, cost_delta_pct: 0,
      cabinet_loss_pct: 0, invoiced_cost: 0, verdict: 'reconciled' } };
    rerender(<BillVarianceCard vehicleId={7} />);
    expect(screen.queryByText('No reconciliation data yet')).not.toBeInTheDocument();
    expect(screen.getByText('0 measured · 0 invoiced DC sessions')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    for (const label of ['Energy Δ', 'Cost Δ', 'Cabinet loss', 'Invoiced total']) {
      expect(metric(container, label)).toHaveAttribute('data-value-state', 'value');
      expect(metric(container, label).querySelector('[data-operational-value]')).toHaveTextContent('0');
    }
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('retains operands, verdict, explanation and reporting window through failure and recovery', () => {
    const { container, rerender } = show();
    const values = Array.from(container.querySelectorAll('[data-operational-value]'), item => item.textContent);
    source.query = { ...source.query, isSuccess: false, isError: true, error: new Error('Billing refresh failed') };
    rerender(<BillVarianceCard vehicleId={7} />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-operational-value]'), item => item.textContent)).toEqual(values);
    expect(screen.getByText(bill.explanation)).toBeInTheDocument();
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(screen.getByText('3 measured · 2 invoiced DC sessions')).toBeInTheDocument();
    expect(screen.getAllByText(windowCopy).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(source.useBillVariance).toHaveBeenLastCalledWith(7);

    source.query = { ...source.query, isFetching: true, fetchStatus: 'fetching' };
    rerender(<BillVarianceCard vehicleId={7} />);
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    source.query = { ...source.query, error: null, isError: false, isSuccess: true,
      isFetching: false, fetchStatus: 'idle', data: { ...bill, explanation: 'Recovered billing evidence' } };
    rerender(<BillVarianceCard vehicleId={7} />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Recovered billing evidence')).toBeInTheDocument();
    expect(screen.getAllByText(windowCopy).length).toBeGreaterThan(0);
  });

  it('keeps a first-load failure actionable without inventing measurements', () => {
    source.query = { ...source.query, data: undefined, isError: true, isSuccess: false,
      error: new Error('Billing initial load failed') };
    const { container } = show();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(source.retry).toHaveBeenCalledOnce();
  });
});
