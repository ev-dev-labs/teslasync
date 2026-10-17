import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import FSMDistributionWidget from './FSMDistributionWidget';

const hooks = vi.hoisted(() => ({ stats: vi.fn(), transitions: vi.fn(), vehicles: vi.fn(), pie: vi.fn() }));
vi.mock('@/api/hooks/useFSM', () => ({
  useFSMStats: (...args: unknown[]) => hooks.stats(...args),
  useFSMTransitions: (...args: unknown[]) => hooks.transitions(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => hooks.vehicles() }));
vi.mock('@/components/charts', async (original) => {
  const actual = await original<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Pie: ({ data, children }: { data: unknown; children?: ReactNode }) => { hooks.pie(data); return <div>{children}</div>; },
    Cell: () => null,
    Tooltip: () => null,
  };
});
vi.mock('@/hooks/useDateFormat', async (original) => {
  const actual = await original<typeof import('@/hooks/useDateFormat')>();
  return {
    ...actual,
    useDateFormat: () => ({
      formatTime: () => 'preferred absolute clock',
      formatDateTime: () => 'preferred absolute clock',
      formatRelative: () => 'alternate relative clock',
    }),
  };
});
vi.mock('@/hooks/useTimeFormatPreference', () => ({ useTimeFormatPreference: () => 'absolute' }));

const transitions = Array.from({ length: 6 }, (_, index) => ({
  id: index,
  from_state: `very-long-origin-state-${index}`,
  to_state: `very-long-destination-state-${index}`,
  ts: '2026-09-15T12:00:00Z',
}));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.stats.mockReturnValue(queryResult({ enabled: true, stats: { driving: 3600000, charging: 1800000 } }));
  hooks.transitions.mockReturnValue(queryResult({ data: transitions }));
});

describe('state distribution source boundaries', () => {
  it('retains all five full transition rows and original preference-owned clocks when stats fail', () => {
    const retryStats = vi.fn();
    const retryTransitions = vi.fn();
    hooks.stats.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Stats offline'), refetch: retryStats }));
    hooks.transitions.mockReturnValue(queryResult({ data: transitions }, { refetch: retryTransitions }));
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('State distribution could not be loaded.')).toBeVisible();
    expect(screen.getByText(transitions[0].from_state)).toBeVisible();
    expect(screen.getByText(transitions[4].to_state)).toBeVisible();
    expect(screen.queryByText(transitions[5].from_state)).not.toBeInTheDocument();
    expect(screen.getAllByText('preferred absolute clock')).toHaveLength(5);
    expect(hooks.transitions).toHaveBeenCalledWith('7', 'vehicle', 24, 1, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryStats).toHaveBeenCalledOnce();
    expect(retryTransitions).not.toHaveBeenCalled();
  });

  it('retains the source-ranked distribution while transitions fail independently', () => {
    const retry = vi.fn();
    hooks.transitions.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Transitions offline'), refetch: retry }));
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('img', { name: 'Time spent in each vehicle state' })).toBeVisible();
    expect(hooks.pie).toHaveBeenCalledWith([
      { state: 'driving', value: 3600000, pct: (3600000 / 5400000) * 100 },
      { state: 'charging', value: 1800000, pct: (1800000 / 5400000) * 100 },
    ]);
    expect(screen.getByText('Recent transitions could not be loaded.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the transition heading and successful-empty state visible alongside the donut', () => {
    hooks.transitions.mockReturnValue(queryResult({ data: [] }));
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('heading', { name: 'Recent transitions' })).toBeVisible();
    expect(screen.getByText('No recent transitions')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Time spent in each vehicle state' })).toBeVisible();
  });
});
