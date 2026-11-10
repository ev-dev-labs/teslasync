import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

import DashboardStatsWidget from './DashboardStatsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ''),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  layouts: vi.fn(),
  fsm: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => mocks.vehicles(),
}));
vi.mock('@/api/hooks/useSettings', () => ({
  useDashboardLayouts: () => mocks.layouts(),
}));
vi.mock('@/api/hooks/useAdmin', () => ({
  useVehicleStateMachine: (vehicleId: string) => mocks.fsm(vehicleId),
}));

function query<T>(data: T | undefined, over: Partial<Omit<DataStateSource<T>, 'data'>> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

async function renderWidget(packId: PackId, cols = 2, vehicleId?: number, hasStats = true) {
  const view = render(
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DashboardStatsWidget size={{ cols, rows: 2 }} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>,
  );
  if (packId !== 'classic' && hasStats) {
    await waitFor(() => {
      expect(view.container.querySelector(`[data-status-appearance="${PACK_APPEARANCES[packId]}"]`)).not.toBeNull();
    });
  }
  return view;
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mocks.vehicles.mockReset();
  mocks.layouts.mockReset();
  mocks.fsm.mockReset();
  mocks.vehicles.mockReturnValue(query([{ id: 1 }]));
  mocks.layouts.mockReturnValue(query({
    active_id: 'main',
    dashboards: [
      { id: 'main', name: 'Main', widgets: [{ id: 'w1' }, { id: 'w2' }] },
    ],
  }));
  mocks.fsm.mockReturnValue(query({ state: 'charging' }));
});

describe.each(PACK_IDS)('DashboardStatsWidget (%s)', (packId) => {
  it('matches the After card with real layout and vehicle-state values', async () => {
    await renderWidget(packId, 2);
    expect(screen.getByText('Widgets placed')).toBeInTheDocument();
    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Car state')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('uses only the active dashboard widgets and the resolved vehicle state', async () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [
        { id: 'other', widgets: [] },
        { id: 'main', widgets: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }] },
      ],
    }));
    await renderWidget(packId, 3, 42);
    expect(mocks.fsm).toHaveBeenCalledWith('42');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('uses a single headline in compact mode without duplicating metrics', async () => {
    await renderWidget(packId, 1);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Widgets placed')).toBeInTheDocument();
    expect(screen.queryByText('Dashboards')).not.toBeInTheDocument();
    expect(screen.queryByText('Car state')).not.toBeInTheDocument();
  });

  it('keeps unknown layout and state values honest', async () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'missing',
      dashboards: [{ id: 'other', widgets: [] }],
    }));
    mocks.fsm.mockReturnValue(query(undefined));
    await renderWidget(packId, 2);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-body').closest('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('does not invent a zero when dashboard discovery is empty', async () => {
    mocks.layouts.mockReturnValue(query({ active_id: 'main', dashboards: [] }));
    mocks.fsm.mockReturnValue(query({ state: 'parked' }));
    await renderWidget(packId, 2);
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('refetches layout and current vehicle sources from the shell freshness control', async () => {
    const layoutRefetch = vi.fn();
    const fsmRefetch = vi.fn();
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: [{ id: 'w1' }] }],
    }, { refetch: layoutRefetch }));
    mocks.fsm.mockReturnValue(query({ state: 'online' }, { refetch: fsmRefetch }));
    await renderWidget(packId, 2, 7);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(layoutRefetch).toHaveBeenCalledTimes(1);
    expect(fsmRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a useful shared empty state when no primary source has data', async () => {
    const layoutRefetch = vi.fn();
    const fsmRefetch = vi.fn();
    const vehiclesRefetch = vi.fn();
    mocks.layouts.mockReturnValue(query(null, { refetch: layoutRefetch }));
    mocks.fsm.mockReturnValue(query(null, { refetch: fsmRefetch }));
    mocks.vehicles.mockReturnValue(query([], { refetch: vehiclesRefetch }));
    await renderWidget(packId, 2, undefined, false);
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fleet' })).toHaveAttribute('href', '/vehicles');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(layoutRefetch).toHaveBeenCalledTimes(1);
    expect(vehiclesRefetch).toHaveBeenCalledTimes(1);
    expect(fsmRefetch).not.toHaveBeenCalled();
  });

  it('preserves a real zero widget count and the nested vehicle state', async () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: [] }],
    }));
    mocks.fsm.mockReturnValue(query({ state: { state: ' parked ' } }));
    await renderWidget(packId);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('does not display malformed widget collections or vehicle state as valid stats', async () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: { length: 5 } }],
    }));
    mocks.fsm.mockReturnValue(query({ state: { state: Number.NaN } }));
    await renderWidget(packId);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity|\[object Object\]/)).not.toBeInTheDocument();
  });

  it('does not use or refetch cached vehicle state for an invalid explicit vehicle', async () => {
    const layoutRefetch = vi.fn();
    const fsmRefetch = vi.fn();
    const vehiclesRefetch = vi.fn();
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: [] }],
    }, { refetch: layoutRefetch }));
    mocks.fsm.mockReturnValue(query({ state: 'charging' }, { refetch: fsmRefetch }));
    mocks.vehicles.mockReturnValue(query([{ id: 1 }], { refetch: vehiclesRefetch }));
    await renderWidget(packId, 2, 0);
    expect(mocks.fsm).toHaveBeenCalledWith('');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(layoutRefetch).toHaveBeenCalledTimes(1);
    expect(fsmRefetch).not.toHaveBeenCalled();
    expect(vehiclesRefetch).not.toHaveBeenCalled();
  });

  it('shows initial loading without fabricating empty or zero stats', async () => {
    mocks.layouts.mockReturnValue(query(undefined, { isPending: true, isFetching: true, dataUpdatedAt: 0 }));
    mocks.fsm.mockReturnValue(query(undefined, { isPending: true, isFetching: true, dataUpdatedAt: 0 }));
    await renderWidget(packId, 2, 7, false);
    const shell = screen.getByTestId('widget-body').closest('[data-data-state]');
    expect(shell).toHaveAttribute('data-data-state', 'initial');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Widgets placed')).not.toBeInTheDocument();
    expect(screen.queryByText('No dashboard stats available')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows initial source failure with a retry instead of empty stats', async () => {
    const layoutRefetch = vi.fn();
    const fsmRefetch = vi.fn();
    const failure = { isError: true, error: new Error('Request failed'), dataUpdatedAt: 0 };
    mocks.layouts.mockReturnValue(query(undefined, { ...failure, refetch: layoutRefetch }));
    mocks.fsm.mockReturnValue(query(undefined, { ...failure, refetch: fsmRefetch }));
    await renderWidget(packId, 2, 7, false);
    expect(screen.getByTestId('widget-body').closest('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByText('Widgets placed')).not.toBeInTheDocument();
    expect(screen.queryByText('No dashboard stats available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(layoutRefetch).toHaveBeenCalledTimes(1);
    expect(fsmRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps retained stats and their source-trust warning after a refresh fails', async () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: [{ id: 'w1' }, { id: 'w2' }] }],
    }, { isError: true, error: new Error('Layout refresh failed') }));
    mocks.fsm.mockReturnValue(query({ state: 'charging' }, {
      isError: true, error: new Error('Vehicle refresh failed'),
    }));
    await renderWidget(packId, 2, 7);
    const shell = screen.getByTestId('widget-body').closest('[data-data-state]');
    expect(shell).toHaveAttribute('data-data-state', 'stale');
    expect(shell).toHaveAttribute('data-motion-suppressed', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
    expect(screen.queryByText('No dashboard stats available')).not.toBeInTheDocument();
  });
});
