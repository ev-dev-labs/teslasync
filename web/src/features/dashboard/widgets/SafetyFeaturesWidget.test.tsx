import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

const medium: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };

const active = {
  forward_collision_warning: 'ForwardCollisionSensitivityAverage',
  automatic_emergency_braking_off: false,
  lane_departure_avoidance: 'LaneAssistLevelWarning',
  blind_spot_collision_warning: true,
  speed_limit_warning: 'SpeedAssistLevelChime',
};

function query(data: unknown = active, overrides: Record<string, unknown> = {}) {
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

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  safetyMock.mockReset();
  vehiclesMock.mockReset();
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  safetyMock.mockReturnValue(query());
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

describe('SafetyFeaturesWidget', () => {
  it('renders the source-backed After-card rows with labels and values', () => {
    renderWidget(<SafetyFeaturesWidget size={medium} />);
    expect(screen.getByText('Forward collision warning')).toBeInTheDocument();
    expect(screen.getByText('Auto emergency braking')).toBeInTheDocument();
    expect(screen.getByText('Lane departure')).toBeInTheDocument();
    expect(screen.getByText('Blind spot')).toBeInTheDocument();
    expect(screen.getByText('Speed limit warning')).toBeInTheDocument();
  });

  it('keeps unknown and inactive readings visible', () => {
    safetyMock.mockReturnValue(query({
      forward_collision_warning: null,
      automatic_emergency_braking_off: true,
      lane_departure_avoidance: 'LaneAssistLevelNone',
      blind_spot_collision_warning: false,
      emergency_lane_departure_avoidance: null,
      speed_limit_warning: false,
    }));
    renderWidget(<SafetyFeaturesWidget size={medium} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('uses the vehicle prop and shared refresh control', () => {
    const refetch = vi.fn();
    safetyMock.mockReturnValue(query(active, { refetch }));
    renderWidget(<SafetyFeaturesWidget vehicleId={7} size={compact} />);
    expect(safetyMock).toHaveBeenCalledWith('7');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows loading, error, and empty states', () => {
    safetyMock.mockReturnValue(query(undefined, { isLoading: true }));
    const loading = renderWidget(<SafetyFeaturesWidget size={medium} />);
    expect(screen.getByRole('heading', { name: 'Safety features' })).toBeInTheDocument();
    expect(screen.queryByText('No safety data')).not.toBeInTheDocument();
    loading.unmount();

    safetyMock.mockReturnValue(query(undefined, { isError: true, error: new Error('boom') }));
    const failed = renderWidget(<SafetyFeaturesWidget size={medium} />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    failed.unmount();

    safetyMock.mockReturnValue(query(null));
    renderWidget(<SafetyFeaturesWidget size={medium} />);
    expect(screen.getByText('No safety data')).toBeInTheDocument();
  });
});
