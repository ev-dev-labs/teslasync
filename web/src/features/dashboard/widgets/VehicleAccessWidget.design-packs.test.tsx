import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleDriver, VehicleInvitation } from '@/api/types';
import VehicleAccessWidget from './VehicleAccessWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
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
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
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
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const NOW = '2026-11-06T12:00:00.000Z';
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };

function driver(overrides: Partial<VehicleDriver> = {}): VehicleDriver {
  return {
    id: 1, vehicle_id: 7, share_user_id: 10, driver_name: 'Alice',
    driver_email: 'alice@example.com', role: 'owner', fetched_at: NOW, ...overrides,
  };
}

function invitation(overrides: Partial<VehicleInvitation> = {}): VehicleInvitation {
  return {
    id: 1, vehicle_id: 7, invitation_id: 'inv-1', invite_url: null,
    status: 'pending', expires_at: null, created_by: 'Carol',
    fetched_at: NOW, created_at: NOW, ...overrides,
  };
}

const DRIVERS = [driver(), driver({ id: 2, driver_name: 'Bob', role: 'driver' })];
const INVITATIONS = [
  invitation(),
  invitation({ id: 2, invitation_id: 'inv-2', created_by: 'Dana', status: 'accepted' }),
  invitation({ id: 3, invitation_id: 'inv-3', created_by: 'Eli', status: 'expired' }),
];
type MobileData = { data: { enabled: boolean } | null; fetched_at: string | null };

function query<T>(data: T | undefined, overrides: {
  error?: Error | null; isError?: boolean; isLoading?: boolean; isPending?: boolean;
  isFetching?: boolean; isStale?: boolean; dataUpdatedAt?: number;
} = {}) {
  return {
    data, error: null as Error | null, isError: false, isLoading: false, isPending: false,
    isFetching: false, isStale: false, dataUpdatedAt: data === undefined ? 0 : Date.now(),
    refetch: vi.fn(), ...overrides,
  };
}

let driverQuery: ReturnType<typeof query<VehicleDriver[]>>;
let invitationQuery: ReturnType<typeof query<VehicleInvitation[]>>;
let mobileQuery: ReturnType<typeof query<MobileData>>;

function widget(packId: string, size = FULL, vehicleId?: number) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <VehicleAccessWidget size={size} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectPresentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(
    container.querySelector(`[data-widget-family="list"][data-widget-appearance="${appearance}"]`),
  ).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue(query([{ id: 7, display_name: 'Selected car' }]));
  driverQuery = query(DRIVERS);
  invitationQuery = query(INVITATIONS);
  mobileQuery = query<MobileData>({ data: { enabled: true }, fetched_at: NOW });
  driversMock.mockReturnValue(driverQuery);
  invitationsMock.mockReturnValue(invitationQuery);
  mobileMock.mockReturnValue(mobileQuery);
});

describe.each(Object.entries(PACK_APPEARANCES))('Vehicle access %s (%s)', (packId, appearance) => {
  it('keeps actual drivers, all invitation states, timestamps, mobile access and refresh in one controller', async () => {
    const { container } = render(widget(packId, FULL, 42));
    await expectPresentation(container, appearance);

    expect(screen.getByRole('heading', { name: 'Vehicle access', level: 3 })).toBeVisible();
    const drivers = within(screen.getByRole('region', { name: 'Authorized drivers' }));
    expect(drivers.getByText('Alice')).toBeVisible();
    expect(drivers.getByText('Owner')).toBeVisible();
    expect(drivers.getByText('Bob')).toBeVisible();
    expect(drivers.getByText('Driver')).toBeVisible();
    const invitations = within(screen.getByRole('region', { name: 'Invitations' }));
    for (const label of ['Carol', 'Dana', 'Eli', 'Pending', 'Accepted', 'Expired']) {
      expect(invitations.getByText(label)).toBeVisible();
    }
    expect(invitations.getAllByText(NOW)).toHaveLength(3);
    expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('1');
    expect(screen.getByText('Pending invitations are separate from active permissions.')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Mobile access' }))
      .getByText('Mobile access enabled')).toBeVisible();
    expect(container.querySelector('[data-widget-family="list"] .lucide-users')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    expect(vehiclesMock).toHaveBeenCalledTimes(1);
    for (const source of [driversMock, invitationsMock, mobileMock]) {
      expect(source).toHaveBeenCalledTimes(1);
      expect(source).toHaveBeenCalledWith('42');
    }
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    for (const source of [driverQuery, invitationQuery, mobileQuery]) {
      expect(source.refetch).toHaveBeenCalledOnce();
    }
  });

  it('preserves the compact summary without substituting pending invitations for authorized drivers', async () => {
    const { container } = render(widget(packId, COMPACT));
    await expectPresentation(container, appearance);
    expect(screen.getByText('2')).toBeVisible();
    expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('1');
    expect(screen.getByText('Mobile access enabled')).toBeVisible();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(driversMock).toHaveBeenCalledWith('7');
  });

  it('keeps missing sources visible as unknown, never zero drivers or enabled mobile access', async () => {
    driversMock.mockReturnValue(query<VehicleDriver[]>(undefined));
    invitationsMock.mockReturnValue(query<VehicleInvitation[]>(undefined));
    mobileMock.mockReturnValue(query<MobileData>({ data: null, fetched_at: null }));
    const { container } = render(widget(packId));
    await expectPresentation(container, appearance);
    expect(within(screen.getByRole('region', { name: 'Authorized drivers' })).getByText('Unknown')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Invitations' })).getByText('Unknown')).toBeVisible();
    expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('—');
    expect(screen.getByText('Mobile access unknown')).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile access enabled')).not.toBeInTheDocument();
    expect(screen.queryByText('No authorized drivers')).not.toBeInTheDocument();
  });

  it('distinguishes confirmed empty lists and disabled mobile access from missing sources', async () => {
    driversMock.mockReturnValue(query<VehicleDriver[]>([]));
    invitationsMock.mockReturnValue(query<VehicleInvitation[]>([]));
    mobileMock.mockReturnValue(query<MobileData>({ data: { enabled: false }, fetched_at: NOW }));
    const { container } = render(widget(packId));
    await expectPresentation(container, appearance);
    expect(screen.getByText('No authorized drivers')).toBeVisible();
    expect(screen.getByText('No pending invitations')).toBeVisible();
    expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('0');
    expect(screen.getByText('Mobile access disabled')).toBeVisible();
    expect(screen.queryByText('Mobile access unknown')).not.toBeInTheDocument();
  });
});

it('preserves Classic full rows, compact driver count and the accessible mobile indicator after switching packs', async () => {
  const view = render(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Alice')).toBeVisible();
  expect(screen.getByText('Carol')).toBeVisible();
  expect(screen.getByText('Accepted')).toBeVisible();
  expect(screen.getByText('Expired')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Invitations' })).not.toBeInTheDocument();
  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(widget(packId));
    await expectPresentation(view.container, appearance);
    expect(screen.getByText('Alice')).toBeVisible();
    expect(screen.getByText('Carol')).toBeVisible();
  }
  view.rerender(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Alice')).toBeVisible();
  expect(screen.getByText('Carol')).toBeVisible();

  mobileMock.mockReturnValue(query<MobileData>({ data: { enabled: false }, fetched_at: NOW }));
  view.rerender(widget('unknown-pack', COMPACT));
  expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(screen.getByText('2 drivers')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Mobile access disabled' })).toBeVisible();
  expect(screen.queryByText('Pending invitations')).not.toBeInTheDocument();
});

it('retries only a failed invitation source without removing drivers or mobile status', async () => {
  const drivers = query(DRIVERS);
  const invitations = query<VehicleInvitation[]>(undefined, { isError: true, error: new Error('Invitations unavailable') });
  const mobile = query<MobileData>({ data: { enabled: true }, fetched_at: NOW });
  driversMock.mockReturnValue(drivers);
  invitationsMock.mockReturnValue(invitations);
  mobileMock.mockReturnValue(mobile);
  const { container } = render(widget('v4', FULL, 19));
  await expectPresentation(container, 'owner');
  expect(screen.getByText('Alice')).toBeVisible();
  expect(screen.getByText('Mobile access enabled')).toBeVisible();
  expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('—');
  const source = within(screen.getByRole('region', { name: 'Invitations' }));
  fireEvent.click(source.getByRole('button', { name: /try again|retry/i }));
  expect(invitations.refetch).toHaveBeenCalledOnce();
  expect(drivers.refetch).not.toHaveBeenCalled();
  expect(mobile.refetch).not.toHaveBeenCalled();
  expect(invitationsMock).toHaveBeenCalledWith('19');
});

it('retains cached rows and exposes an individual retry when a driver refresh fails', async () => {
  const drivers = query(DRIVERS, { isError: true, isStale: true, error: new Error('Driver refresh failed') });
  driversMock.mockReturnValue(drivers);
  const { container } = render(widget('v7'));
  await expectPresentation(container, 'pixel');
  const source = within(screen.getByRole('region', { name: 'Authorized drivers' }));
  expect(source.getByText('Alice')).toBeVisible();
  expect(source.getByText('Bob')).toBeVisible();
  expect(source.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
  expect(screen.getByText('Carol')).toBeVisible();
  fireEvent.click(source.getByRole('button', { name: /refresh/i }));
  expect(drivers.refetch).toHaveBeenCalledOnce();
  expect(invitationQuery.refetch).not.toHaveBeenCalled();
  expect(mobileQuery.refetch).not.toHaveBeenCalled();
});

it('does not interpret an invitation with an unknown status as zero pending invitations', async () => {
  invitationsMock.mockReturnValue(query([invitation({ status: '' })]));
  const { container } = render(widget('v3'));
  await expectPresentation(container, 'precision');
  expect(container.querySelector('[data-access-pending-count]')).toHaveTextContent('—');
  expect(within(screen.getByRole('region', { name: 'Invitations' })).getByText('Unknown')).toBeVisible();
});

it('keeps partial source loading inside its own section and disables global refresh while fetching', async () => {
  const drivers = query<VehicleDriver[]>(undefined, { isLoading: true, isPending: true, isFetching: true });
  driversMock.mockReturnValue(drivers);
  const { container } = render(widget('v2'));
  await expectPresentation(container, 'elevated');
  expect(screen.getByRole('region', { name: 'Authorized drivers' })).toBeVisible();
  expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  expect(screen.getByText('Carol')).toBeVisible();
  expect(screen.getByText('Mobile access enabled')).toBeVisible();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  const refresh = screen.getByRole('button', { name: /refresh/i });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(drivers.refetch).not.toHaveBeenCalled();
});

it('preserves initial vehicle loading and fatal source recovery in the shell', async () => {
  vehiclesMock.mockReturnValue(query(undefined, { isLoading: true, isPending: true }));
  driversMock.mockReturnValue(query<VehicleDriver[]>(undefined));
  invitationsMock.mockReturnValue(query<VehicleInvitation[]>(undefined));
  mobileMock.mockReturnValue(query<MobileData>(undefined));
  const view = render(widget('v6'));
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Vehicle access', level: 3 })).toBeVisible();
  expect(screen.queryByText('0 drivers')).not.toBeInTheDocument();

  vehiclesMock.mockReturnValue(query([{ id: 7 }]));
  const failed = { isError: true, error: new Error('Access unavailable') };
  const drivers = query<VehicleDriver[]>(undefined, failed);
  const invitations = query<VehicleInvitation[]>(undefined, failed);
  const mobile = query<MobileData>(undefined, failed);
  driversMock.mockReturnValue(drivers);
  invitationsMock.mockReturnValue(invitations);
  mobileMock.mockReturnValue(mobile);
  view.rerender(widget('v6'));
  expect(await screen.findByText("Can't reach server")).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
  expect(drivers.refetch).toHaveBeenCalledOnce();
  expect(invitations.refetch).toHaveBeenCalledOnce();
  expect(mobile.refetch).toHaveBeenCalledOnce();
});
