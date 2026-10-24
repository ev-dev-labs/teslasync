import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleDriver, VehicleInvitation } from '@/api/types';
import type { WidgetSize } from './types';

const { vehiclesMock, driversMock, invitationsMock, mobileMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  driversMock: vi.fn(),
  invitationsMock: vi.fn(),
  mobileMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleAccess', () => ({
  useVehicleDrivers: (...args: unknown[]) => driversMock(...args),
  useVehicleInvitations: (...args: unknown[]) => invitationsMock(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleMobileEnabled: (...args: unknown[]) => mobileMock(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(opts?.[key] ?? ''))
        : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: unknown) => String(value),
    formatDateShort: (value: unknown) => value == null ? '—' : String(value),
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import VehicleAccessWidget from './VehicleAccessWidget';

const NOW = '2026-07-05T12:00:00.000Z';

function makeDriver(over: Partial<VehicleDriver> = {}): VehicleDriver {
  return {
    id: 1, vehicle_id: 7, share_user_id: 10,
    driver_email: 'alice@example.com', driver_name: 'Alice',
    role: 'owner', fetched_at: NOW, ...over,
  };
}
function makeInvitation(over: Partial<VehicleInvitation> = {}): VehicleInvitation {
  return {
    id: 1, vehicle_id: 7, invitation_id: 'inv-1', invite_url: null,
    status: 'pending', expires_at: null, created_by: 'Bob',
    fetched_at: NOW, created_at: NOW, ...over,
  };
}
function query<T>(over: {
  data?: T; isLoading?: boolean; isFetching?: boolean; isStale?: boolean;
  isError?: boolean; dataUpdatedAt?: number; refetch?: () => void;
} = {}) {
  return {
    data: undefined as T | undefined,
    isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: Date.parse(NOW), refetch: vi.fn(), ...over,
  };
}
function setDrivers(over: Parameters<typeof query<VehicleDriver[]>>[0] = {}) {
  const q = query<VehicleDriver[]>(over); driversMock.mockReturnValue(q); return q;
}
function setInvitations(over: Parameters<typeof query<VehicleInvitation[]>>[0] = {}) {
  const q = query<VehicleInvitation[]>(over); invitationsMock.mockReturnValue(q); return q;
}
function setMobile(over: Parameters<typeof query<{ data: { enabled: boolean } | null; fetched_at: string | null }>>[0] = {}) {
  const q = query<{ data: { enabled: boolean } | null; fetched_at: string | null }>(over);
  mobileMock.mockReturnValue(q); return q;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };
function renderWidget(size = FULL, vehicleId?: number) {
  return render(<MemoryRouter><VehicleAccessWidget size={size} vehicleId={vehicleId} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }], isLoading: false });
  setDrivers({ data: [] });
  setInvitations({ data: [] });
  setMobile({ data: { data: { enabled: true }, fetched_at: NOW } });
});

describe('VehicleAccessWidget After-card behavior', () => {
  it('renders drivers and invitations as one concise row list with status labels', () => {
    setDrivers({ data: [makeDriver({ driver_name: 'Alice', role: 'owner' }), makeDriver({ id: 2, driver_name: 'Bob', role: 'driver' })] });
    setInvitations({ data: [makeInvitation({ created_by: 'Carol', status: 'pending' })] });
    renderWidget(FULL);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Driver')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('uses compact driver count and no mobile or access-section labels', () => {
    setDrivers({ data: [makeDriver(), makeDriver({ id: 2 })] });
    setMobile({ data: { data: { enabled: false }, fetched_at: NOW } });
    renderWidget(COMPACT);

    expect(screen.getByText('2 drivers')).toBeInTheDocument();
    expect(screen.queryByText('Authorized drivers')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending invitations')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mobile access disabled' })).toBeInTheDocument();
  });

  it('does not convert missing driver data into zero drivers', () => {
    setDrivers({ data: undefined, isError: true });
    setInvitations({ data: [] });
    renderWidget(COMPACT);
    expect(screen.getByText('— drivers')).toBeInTheDocument();
    expect(screen.queryByText('0 drivers')).not.toBeInTheDocument();
  });

  it('keeps independent source trust and retries only the failed source', () => {
    const drivers = setDrivers({ data: [makeDriver()] });
    setInvitations({ data: undefined, isError: true });
    const mobile = setMobile({ data: { data: { enabled: true }, fetched_at: NOW } });
    renderWidget(FULL);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(drivers.refetch).not.toHaveBeenCalled();
    expect(mobile.refetch).not.toHaveBeenCalled();
  });

  it('retains cached rows during background errors and exposes shared freshness refresh', () => {
    setDrivers({ data: [makeDriver()], isError: true });
    setInvitations({ data: [] });
    renderWidget(FULL);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
  });

  it('shows loading, empty, vehicle scope, and resolved vehicle behavior', () => {
    setDrivers({ isLoading: true, data: undefined });
    const first = renderWidget(FULL, 5);
    expect(first.container.querySelector('[data-role="widget-shell-header"]')).not.toBeNull();

    first.unmount();
    setDrivers({ data: [] });
    setInvitations({ data: [] });
    setMobile({ data: { data: null, fetched_at: NOW } });
    renderWidget(FULL);
    expect(screen.getByText('No access data available')).toBeInTheDocument();
    expect(driversMock).toHaveBeenCalledWith('5');
  });
});
