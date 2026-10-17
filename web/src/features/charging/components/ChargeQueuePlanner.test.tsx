/**
 * ChargeQueuePlanner — posts per-vehicle rows; renders ordered slots.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { QueueAdvice } from '@/types/charging';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(11, 16)),
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useCharging', () => ({ useAdviseChargeQueue: vi.fn() }));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useAdviseChargeQueue } from '@/api/hooks/useCharging';
import { ChargeQueuePlanner } from './ChargeQueuePlanner';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockAdvise = useAdviseChargeQueue as unknown as ReturnType<typeof vi.fn>;

const cars = [
  { id: 1, display_name: 'Alpha' },
  { id: 2, display_name: 'Beta' },
];

const advice: QueueAdvice = {
  all_feasible: true,
  explanation: 'Charge in order.',
  slots: [
    { vehicle_id: 2, position: 1, start_time: '2026-03-10T18:00:00.000Z', end_time: '2026-03-10T21:00:00.000Z', kwh_needed: 33, ready_by: '2026-03-11T06:00:00.000Z', slack_hours: 9, feasible: true },
    { vehicle_id: 1, position: 2, start_time: '2026-03-10T21:00:00.000Z', end_time: '2026-03-11T00:00:00.000Z', kwh_needed: 22.5, ready_by: '2026-03-11T07:30:00.000Z', slack_hours: 7.5, feasible: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVehicles.mockReturnValue({ data: cars });
  mockAdvise.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
});

describe('ChargeQueuePlanner', () => {
  it('shows active fleet loading without asserting a fleet prerequisite', () => {
    mockVehicles.mockReturnValue({ data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching' });
    render(<ChargeQueuePlanner />);
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeTruthy();
    expect(screen.queryByText('Add a second vehicle to plan a shared-charger queue.')).toBeNull();
    expect(screen.queryByText('Plan queue')).toBeNull();
  });

  it('shows a paused unresolved fleet and retries only that source', () => {
    const refetch = vi.fn();
    const mutate = vi.fn();
    mockVehicles.mockReturnValue({ data: undefined, isPending: true, fetchStatus: 'paused', refetch });
    mockAdvise.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.queryByText('Add a second vehicle to plan a shared-charger queue.')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading...' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('reports a failed initial fleet request and recovers through its retry', () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue({ data: undefined, error: new Error('Fleet unavailable'), isError: true, refetch });
    const { rerender } = render(<MemoryRouter><ChargeQueuePlanner /></MemoryRouter>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Add a second vehicle to plan a shared-charger queue.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockVehicles.mockReturnValue({ data: cars, error: null, fetchStatus: 'idle', refetch });
    rerender(<MemoryRouter><ChargeQueuePlanner /></MemoryRouter>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Plan queue')).toBeTruthy();
  });

  it('asserts the prerequisite for a successful empty fleet', () => {
    mockVehicles.mockReturnValue({ data: [], isSuccess: true, fetchStatus: 'idle' });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('Add a second vehicle to plan a shared-charger queue.')).toBeTruthy();
    expect(screen.queryByText('Plan queue')).toBeNull();
  });

  it.each(['error', 'paused'] as const)('retains edited business inputs and advice during a fleet refresh %s and recovery', (outcome) => {
    const refetch = vi.fn();
    const mutate = vi.fn();
    mockAdvise.mockReturnValue({ mutate, data: advice, isPending: false, isError: false, error: null });
    const { rerender } = render(<ChargeQueuePlanner />);
    fireEvent.change(screen.getAllByLabelText('Now %')[0], { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Charger (kW)'), { target: { value: '7' } });

    mockVehicles.mockReturnValue({
      data: cars,
      error: outcome === 'error' ? new Error('Fleet refresh failed') : null,
      isError: outcome === 'error',
      fetchStatus: outcome === 'paused' ? 'paused' : 'idle',
      refetch,
    });
    rerender(<ChargeQueuePlanner />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    expect(screen.getByText('Charge in order.')).toBeTruthy();
    expect(screen.getAllByLabelText('Now %')[0]).toHaveValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Plan queue' }));
    expect(mutate).toHaveBeenCalledWith({
      charger_kw: 7,
      vehicles: [
        { vehicle_id: 1, current_soc: 0, target_soc: 80, ready_by: '07:30' },
        { vehicle_id: 2, current_soc: 40, target_soc: 80, ready_by: '07:30' },
      ],
    });

    mockVehicles.mockReturnValue({ data: cars, error: null, fetchStatus: 'idle', refetch });
    rerender(<ChargeQueuePlanner />);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('Charge in order.')).toBeTruthy();
    expect(screen.getAllByLabelText('Now %')[0]).toHaveValue(0);
  });

  it('does not assert a current fleet prerequisite from a retained empty refresh failure', () => {
    mockVehicles.mockReturnValue({ data: [], error: new Error('Refresh failed'), refetch: vi.fn() });
    render(<ChargeQueuePlanner />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    expect(screen.queryByText('Add a second vehicle to plan a shared-charger queue.')).toBeNull();
  });

  it('prompts for a second vehicle with only one car', () => {
    mockVehicles.mockReturnValue({ data: cars.slice(0, 1) });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('Add a second vehicle to plan a shared-charger queue.')).toBeTruthy();
  });

  it('posts default rows for every car', () => {
    const mutate = vi.fn();
    mockAdvise.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<ChargeQueuePlanner />);
    fireEvent.click(screen.getByText('Plan queue'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      charger_kw: 11,
      vehicles: [
        { vehicle_id: 1, current_soc: 40, target_soc: 80, ready_by: '07:30' },
        { vehicle_id: 2, current_soc: 40, target_soc: 80, ready_by: '07:30' },
      ],
    });
  });

  it('renders the ordered queue with per-car windows', () => {
    mockAdvise.mockReturnValue({ mutate: vi.fn(), data: advice, isPending: false, isError: false, error: null });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('All cars ready on time')).toBeTruthy();
    expect(screen.getByText('Charge in order.')).toBeTruthy();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });
});
