import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { FSMTransition } from '@/types/fsm';
import type { StatPeriod } from '@/lib/metric-reference';
import { computeFlapIds } from '../FSMHealthPanel';
import { FSMOperationalBrief, fsmMetrics } from './FSMOperationalBrief';

vi.mock('react-i18next', async () => {
  const { createInstance: create } = await import('i18next');
  const instance = create();
  await instance.init({ lng: 'en', fallbackLng: 'en', resources: {} });
  return { useTranslation: () => ({ t: instance.t, i18n: instance }) };
});
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> };
});
afterEach(cleanup);
const translation = createInstance();
void translation.init({ lng: 'en', fallbackLng: 'en', resources: {}, initAsync: false });
const t = translation.t;
const period: StatPeriod = {
  kind: 'analysis', label: '2026-10-01 → 2026-10-02', start: '2026-10-01T00:00:00Z',
  endExclusive: '2026-10-03T00:00:00Z', timezone: 'UTC', completeness: 'subset',
  provenance: 'Loaded server page; total across matching pages; separate live snapshot.',
};

describe('FSM shared OperationalBrief', () => {
  it('retains numeric page versus total, detector-backed flaps and textual current state', () => {
    const rows = Array.from({ length: 7 }, (_, index): FSMTransition => ({
      id: index + 1, ts: `2026-10-01T00:00:0${index}Z`, vehicle_id: 7,
      fsm_name: 'vehicle', from_state: 'parked', to_state: 'online',
      trigger: 'connected', details: {},
    }));
    const metrics = fsmMetrics(rows, 73, 'parked', t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([7, 73, computeFlapIds(rows).size, 'parked']);
    expect(metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'status']);
    expect(metrics[0]?.context).toBe('7 / 73');
    expect(metrics[2]?.context).toBe('Loaded transition page only');
    expect(metrics[3]?.context).toContain('independent of the transition range');
  });

  it('preserves measured zero without substituting for unknown page, total or state', () => {
    expect(fsmMetrics([], 0, null, t).map(metric => metric.rawValue)).toEqual([0, 0, 0, null]);
    expect(fsmMetrics(undefined, undefined, null, t).map(metric => metric.rawValue)).toEqual([null, null, null, null]);
    expect(fsmMetrics([], undefined, 'asleep', t).map(metric => metric.rawValue)).toEqual([0, null, 0, 'asleep']);
  });

  it('renders the accepted strip, explicit selected range and independent retained live state', () => {
    const retry = vi.fn();
    const { rerender } = render(<MemoryRouter>
      <FSMOperationalBrief transitions={{ data: { data: [], total: 73 } }} stateQuery={{ data: {} }}
        currentState="parked" period={period} onRetry={retry} />
    </MemoryRouter>);
    const strip = screen.getByTestId('fsm-summary');
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(strip).toHaveAttribute('data-operational-brief');
    expect(strip).toHaveTextContent('[2026-10-01T00:00:00Z, 2026-10-03T00:00:00Z)');
    expect(screen.getByText('0 / 73')).toBeInTheDocument();
    expect(strip.querySelector('[data-operational-metric="state"] [data-operational-value]')).toHaveTextContent('parked');
    rerender(<MemoryRouter><FSMOperationalBrief transitions={{ error: new Error('history unavailable') }}
      stateQuery={{ data: {}, error: new Error('live refresh failed') }} currentState="parked"
      period={period} onRetry={retry} /></MemoryRouter>);
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(strip.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(strip.querySelector('[data-operational-metric="state"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('opens the shared review drawer with page-versus-total and independently sourced live state', async () => {
    render(<MemoryRouter><FSMOperationalBrief transitions={{ data: { data: [], total: 73 } }}
      stateQuery={{ data: {} }} currentState="parked" period={period} onRetry={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('0 / 73')).toBeInTheDocument();
    expect(within(drawer).getByText(/independent of the transition range/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/2026-10-01T00:00:00Z/).length).toBeGreaterThan(0);
  });
});
