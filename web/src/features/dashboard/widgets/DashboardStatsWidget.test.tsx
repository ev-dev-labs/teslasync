import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

import DashboardStatsWidget from './DashboardStatsWidget';

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

function query<T>(data: T | undefined, over: Record<string, unknown> = {}) {
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

function renderWidget(cols = 2, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <DashboardStatsWidget size={{ cols, rows: 2 }} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
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

describe('DashboardStatsWidget', () => {
  it('matches the After card with real layout and vehicle-state values', () => {
    renderWidget(2);
    expect(screen.getByText('Widgets placed')).toBeInTheDocument();
    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Car state')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('uses only the active dashboard widgets and the resolved vehicle state', () => {
    renderWidget(3, 42);
    expect(mocks.fsm).toHaveBeenCalledWith('42');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('uses a single headline in compact mode without duplicating metrics', () => {
    renderWidget(1);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Widgets placed')).toBeInTheDocument();
    expect(screen.queryByText('Dashboards')).not.toBeInTheDocument();
    expect(screen.queryByText('Car state')).not.toBeInTheDocument();
  });

  it('keeps unknown layout and state values honest', () => {
    mocks.layouts.mockReturnValue(query({
      active_id: 'missing',
      dashboards: [{ id: 'other', widgets: [] }],
    }));
    mocks.fsm.mockReturnValue(query(undefined));
    renderWidget(2);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('does not invent a zero when dashboard discovery is empty', () => {
    mocks.layouts.mockReturnValue(query({ active_id: 'main', dashboards: [] }));
    mocks.fsm.mockReturnValue(query({ state: 'parked' }));
    renderWidget(2);
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('refetches layout and current vehicle sources from the shell freshness control', () => {
    const layoutRefetch = vi.fn();
    const fsmRefetch = vi.fn();
    mocks.layouts.mockReturnValue(query({
      active_id: 'main',
      dashboards: [{ id: 'main', widgets: [{ id: 'w1' }] }],
    }, { refetch: layoutRefetch }));
    mocks.fsm.mockReturnValue(query({ state: 'online' }, { refetch: fsmRefetch }));
    renderWidget(2, 7);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(layoutRefetch).toHaveBeenCalledTimes(1);
    expect(fsmRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a useful shared empty state when no primary source has data', () => {
    mocks.layouts.mockReturnValue(query(null));
    mocks.fsm.mockReturnValue(query(null));
    mocks.vehicles.mockReturnValue(query([]));
    renderWidget(2);
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
  });
});
