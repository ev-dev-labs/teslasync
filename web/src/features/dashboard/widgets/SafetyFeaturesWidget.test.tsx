import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));

const { safetyMock, vehiclesMock } = vi.hoisted(() => ({
  safetyMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({ useSafety: safetyMock }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));

import SafetyFeaturesWidget, {
  boolStatus,
  invertedBoolStatus,
  safetyEnumStatus,
  buildCells,
  buildEntries,
} from './SafetyFeaturesWidget';
import type { WidgetSize } from './types';
import type { DataStateSource } from '@/api/dataState';
import type { SafetySnapshot } from '@/types/vehicle-systems';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const medium: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };

const active: SafetySnapshot = {
  forward_collision_warning: 'ForwardCollisionSensitivityAverage',
  automatic_emergency_braking_off: false,
  lane_departure_avoidance: 'LaneAssistLevelWarning',
  blind_spot_collision_warning: true,
  speed_limit_warning: 'SpeedAssistLevelChime',
};

function query(
  data: SafetySnapshot | null | undefined,
  overrides: Partial<DataStateSource<SafetySnapshot | null>> = {},
) {
  return {
    data,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(node: ReactElement, packId: PackId) {
  return render(node, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>{children}</PackBoundary>
      </MemoryRouter>
    ),
  });
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-status-appearance]')).not.toBeInTheDocument();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-status-appearance]')).toHaveAttribute(
        'data-status-appearance', PACK_APPEARANCES[packId],
      );
    });
  }
}

function expectSafetyRows(values: string[]) {
  expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
    'Forward collision warning',
    'Auto emergency braking',
    'Lane departure',
    'Blind spot',
    'Speed limit warning',
  ]);
  expect(screen.getAllByRole('definition').map((definition) => definition.textContent)).toEqual(values);
}

beforeEach(() => {
  safetyMock.mockReset();
  vehiclesMock.mockReset();
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  safetyMock.mockReturnValue(query(active));
});

describe('SafetyFeaturesWidget helpers', () => {
  it('classifies booleans and enum readings without coercion', () => {
    expect(boolStatus(null)).toBe('unknown');
    expect(boolStatus(true)).toBe('ok');
    expect(invertedBoolStatus(true)).toBe('inactive');
    expect(invertedBoolStatus(false)).toBe('ok');
    expect(safetyEnumStatus(false, 'forward_collision_warning')).toBe('inactive');
    expect(safetyEnumStatus(3, 'cruise_follow_distance')).toBe('ok');
    expect(safetyEnumStatus('ForwardCollisionSensitivityUnknown', 'forward_collision_warning')).toBe('unknown');
  });

  it('builds the After-card safety rows in stable order', () => {
    const tt = (_key: string, fallback: string) => fallback;
    const cells = buildCells(active, tt);
    expect(cells.map((cell) => cell.id)).toEqual([
      'fcw', 'aeb', 'lda', 'bscw', 'slw',
    ]);
    expect(cells.map((cell) => cell.label)).toEqual([
      'Forward collision warning',
      'Auto emergency braking',
      'Lane departure',
      'Blind spot',
      'Speed limit warning',
    ]);
    expect(cells.every((cell) => typeof cell.statusLabel === 'string')).toBe(true);
    const entries = buildEntries(active, tt);
    expect(entries.map((entry) => entry.label)).toEqual(cells.map((cell) => cell.label));
    expect(entries.every((entry) => typeof entry.value === 'string')).toBe(true);
    expect(entries.every((entry) => entry.status)).toBe(true);
  });
});

describe.each(PACK_IDS)('SafetyFeaturesWidget [%s]', (packId) => {
  it.each([
    { name: 'medium', size: medium },
    { name: 'compact', size: compact },
  ])('preserves all five source-backed readings at $name size', async ({ size }) => {
    const { container } = renderWidget(<SafetyFeaturesWidget size={size} />, packId);
    await expectPresentation(container, packId);
    expectSafetyRows(['Average', 'Enabled', 'Warning', 'Enabled', 'Chime']);
    expect(safetyMock).toHaveBeenCalledWith('42');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps unknown and inactive readings visible without changing inverted AEB meaning', async () => {
    safetyMock.mockReturnValue(query({
      forward_collision_warning: null,
      automatic_emergency_braking_off: true,
      lane_departure_avoidance: 'LaneAssistLevelNone',
      blind_spot_collision_warning: false,
      emergency_lane_departure_avoidance: null,
      speed_limit_warning: false,
    }));
    const { container } = renderWidget(<SafetyFeaturesWidget size={medium} />, packId);
    await expectPresentation(container, packId);
    expectSafetyRows(['—', 'Disabled', 'Disabled', 'Disabled', 'Disabled']);
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('distinguishes real zero from unknown and invalid enum readings', async () => {
    safetyMock.mockReturnValue(query({
      forward_collision_warning: 0,
      automatic_emergency_braking_off: null,
      lane_departure_avoidance: Number.NaN,
      blind_spot_collision_warning: null,
      speed_limit_warning: Number.POSITIVE_INFINITY,
    }));
    const { container } = renderWidget(<SafetyFeaturesWidget size={compact} />, packId);
    await expectPresentation(container, packId);
    expectSafetyRows(['0', '—', '—', '—', '—']);
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it('uses the vehicle prop and shared refresh control', async () => {
    const refetch = vi.fn();
    safetyMock.mockReturnValue(query(active, { refetch }));
    const { container } = renderWidget(<SafetyFeaturesWidget vehicleId={7} size={compact} />, packId);
    await expectPresentation(container, packId);
    expect(safetyMock).toHaveBeenCalledWith('7');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows loading, error, and empty states', () => {
    safetyMock.mockReturnValue(query(undefined, { isLoading: true, isPending: true, isFetching: true }));
    const loading = renderWidget(<SafetyFeaturesWidget size={medium} />, packId);
    expect(screen.getByRole('heading', { name: 'Safety features' })).toBeInTheDocument();
    expect(loading.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(loading.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
    expect(screen.queryByText('No safety data')).not.toBeInTheDocument();
    loading.unmount();

    safetyMock.mockReturnValue(query(undefined, { isError: true, error: new Error('boom') }));
    const failed = renderWidget(<SafetyFeaturesWidget size={medium} />, packId);
    expect(failed.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    failed.unmount();

    safetyMock.mockReturnValue(query(null));
    renderWidget(<SafetyFeaturesWidget size={medium} />, packId);
    expect(screen.getByText('No safety data')).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('retains the readings and source warning through failed, paused, and in-flight refreshes', async () => {
    const refetch = vi.fn();
    safetyMock.mockReturnValue(query(active, { refetch, isError: true, isStale: true, error: new Error('refresh failed') }));
    const view = renderWidget(<SafetyFeaturesWidget vehicleId={7} size={medium} />, packId);
    await expectPresentation(view.container, packId);
    expectSafetyRows(['Average', 'Enabled', 'Warning', 'Enabled', 'Chime']);
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    safetyMock.mockReturnValue(query(active, { refetch, fetchStatus: 'paused', isStale: true }));
    view.rerender(<SafetyFeaturesWidget vehicleId={7} size={medium} />);
    expectSafetyRows(['Average', 'Enabled', 'Warning', 'Enabled', 'Chime']);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(view.container.querySelector('[data-motion-suppressed]')).toHaveAttribute('data-motion-suppressed', 'true');

    safetyMock.mockReturnValue(query(active, { refetch, isFetching: true, fetchStatus: 'fetching' }));
    view.rerender(<SafetyFeaturesWidget vehicleId={7} size={medium} />);
    expectSafetyRows(['Average', 'Enabled', 'Warning', 'Enabled', 'Chime']);
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: /refresh/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retries vehicle discovery rather than a disabled safety query', () => {
    const vehicleRefetch = vi.fn();
    const safetyRefetch = vi.fn();
    vehiclesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('vehicle discovery failed'),
      refetch: vehicleRefetch,
    });
    safetyMock.mockReturnValue(query(undefined, { refetch: safetyRefetch }));
    const { container } = renderWidget(<SafetyFeaturesWidget size={medium} />, packId);
    expect(safetyMock).toHaveBeenCalledWith('');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(vehicleRefetch).toHaveBeenCalledTimes(1);
    expect(safetyRefetch).not.toHaveBeenCalled();
  });
});
