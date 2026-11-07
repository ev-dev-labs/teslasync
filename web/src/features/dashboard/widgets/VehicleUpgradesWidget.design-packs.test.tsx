import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useVehicleUpgrades, useVehicles } from '@/api/hooks/useVehicles';
import { useDrives } from '@/api/hooks/useDriving';
import { useShareLinks } from '@/api/hooks/useSharing';
import type { Drive, Vehicle } from '@/api/types';
import type { ShareToken } from '@/types/sharing';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import VehicleUpgradesWidget from './VehicleUpgradesWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useVehicleUpgrades: vi.fn(),
}));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: vi.fn() }));
vi.mock('@/api/hooks/useSharing', () => ({ useShareLinks: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      let text = typeof fallback === 'string' ? fallback : key;
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatRelative: (value: string) => `relative:${value}`,
    formatTime: (value: unknown) => `time:${String(value)}`,
  }),
}));

type UpgradesEnvelope = NonNullable<ReturnType<typeof useVehicleUpgrades>['data']>;

function query<T>(data: T | undefined, overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return {
    data, error: null, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, isSuccess: true, status: 'success',
    fetchStatus: 'idle', dataUpdatedAt: data === undefined ? 0 : Date.now(),
    refetch: vi.fn(), ...overrides,
  } as UseQueryResult<T, Error>;
}

const vehicle: Vehicle = {
  id: 7, vehicle_id: 7, vin: 'TEST-UPGRADES-VEHICLE', display_name: 'Test vehicle',
  model: 'Model 3', trim_badging: '', exterior_color: '', wheel_type: '',
  state: 'online', healthy: true, created_at: '', updated_at: '',
};
const drive: Drive = {
  id: 55, vehicle_id: 7, start_ts: '2026-01-02T12:00:00Z', end_ts: '2026-01-02T13:00:00Z',
  duration_s: 3600, distance_m: 10000, start_address: null, end_address: null,
  start_lat: null, start_lon: null, end_lat: null, end_lon: null,
  start_soc_pct: 80, end_soc_pct: 75, energy_used_wh: null, regen_energy_wh: null,
  avg_speed_mps: null, max_speed_mps: null, avg_power_w: null,
  outside_temp_avg_c: null, inside_temp_avg_c: null, score: null, ended_status: null,
  created_at: '', updated_at: '',
};
const upgrades: UpgradesEnvelope = {
  data: {
    upgrades: [
      { name: 'Acceleration Boost', price: '2000', description: 'Vendor upgrade description', eligible: true },
      { name: 'Connectivity subscription', price: '€99 / month', description: 'Existing subscription', eligible: false },
    ],
  },
  fetched_at: '2026-01-02T12:00:00Z',
};
const sizes: WidgetSize[] = [
  { cols: 1, rows: 2 }, { cols: 2, rows: 3 }, { cols: 3, rows: 3 },
];
const upgradeRefetch = vi.fn();
const driveRefetch = vi.fn();
const shareRefetch = vi.fn();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
let activeExpiry: string;

function share(overrides: Partial<ShareToken> = {}): ShareToken {
  return {
    id: 1, token: 'private-share-token', drive_id: 55, created_by: null,
    title: 'Coast drive', description: null, include_map: true,
    include_telemetry: true, include_speed: true, views: 12,
    expires_at: activeExpiry, created_at: '2026-01-02T12:00:00Z', ...overrides,
  };
}

function renderWidget(packId: unknown = 'classic', size: WidgetSize = sizes[1], vehicleId = 7) {
  const tree = (requestedPackId: unknown) => (
    <MemoryRouter>
      <PackBoundary requestedPackId={requestedPackId}>
        <VehicleUpgradesWidget vehicleId={vehicleId} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="list"][data-widget-appearance="${appearance}"]`,
  )).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  activeExpiry = inDays(7);
  vi.mocked(useVehicles).mockReturnValue(query([vehicle]));
  vi.mocked(useVehicleUpgrades).mockReturnValue(query(upgrades, { refetch: upgradeRefetch }));
  vi.mocked(useDrives).mockReturnValue(query([drive], { refetch: driveRefetch }));
  vi.mocked(useShareLinks).mockReturnValue(query([
    share(),
    share({ id: 2, title: 'Expired drive', expires_at: inDays(-1) }),
  ], { refetch: shareRefetch }));
});

afterEach(() => {
  cleanup();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe.each(Object.entries(PACK_APPEARANCES))('Vehicle upgrades %s / %s', (packId, appearance) => {
  it.each(sizes)('preserves actual upgrade and sharing content and refresh at $cols columns', async size => {
    const { container } = renderWidget(packId, size);
    await expectAppearance(container, appearance);
    expect(screen.getByRole('heading', { name: 'Upgrades & Sharing' })).toBeInTheDocument();
    const headline = container.querySelector<HTMLElement>('.widget-big-number');
    expect(headline).not.toBeNull();
    expect(within(headline!).getByText('1', { exact: true })).toBeInTheDocument();
    expect(within(headline!).getByText('available')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="list"] svg')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('TEST-UPGRADES-VEHICLE');
    expect(container.textContent).not.toContain('private-share-token');

    if (size.cols === 1) {
      expect(screen.queryByText('Available upgrades')).not.toBeInTheDocument();
      expect(screen.queryByText('Share links')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText('Available upgrades')).toBeInTheDocument();
      expect(screen.getByText('Acceleration Boost')).toBeInTheDocument();
      expect(screen.getByText('2,000.00')).toBeInTheDocument();
      expect(screen.getByText('Vendor upgrade description')).toBeInTheDocument();
      expect(screen.getByText('Connectivity subscription')).toBeInTheDocument();
      expect(screen.getByText('€99 / month')).toBeInTheDocument();
      expect(screen.getByText('Existing subscription')).toBeInTheDocument();
      expect(screen.getByText('Share links')).toBeInTheDocument();
      expect(screen.getByText('Coast drive')).toBeInTheDocument();
      expect(screen.getByText(`Expires relative:${activeExpiry} · 12 views`)).toBeInTheDocument();
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.queryByText('Expired drive')).not.toBeInTheDocument();
    }

    expect(useVehicleUpgrades).toHaveBeenCalledExactlyOnceWith('7');
    expect(useDrives).toHaveBeenCalledExactlyOnceWith('7');
    expect(useShareLinks).toHaveBeenCalledExactlyOnceWith('55');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(upgradeRefetch).toHaveBeenCalledOnce();
    if (size.cols === 1) {
      expect(driveRefetch).not.toHaveBeenCalled();
      expect(shareRefetch).not.toHaveBeenCalled();
    } else {
      expect(driveRefetch).toHaveBeenCalledOnce();
      expect(shareRefetch).toHaveBeenCalledOnce();
    }
  });

  it('keeps missing upgrade evidence unknown and retains the independent sharing section', async () => {
    vi.mocked(useVehicleUpgrades).mockReturnValue(query<UpgradesEnvelope>(
      { data: null, fetched_at: null }, { refetch: upgradeRefetch },
    ));
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('.widget-big-number')).not.toHaveTextContent('0');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByText('Available upgrades')).toBeInTheDocument();
    expect(screen.getByText('This widget has no qualifying data yet.')).toBeInTheDocument();
    expect(screen.getByText('Share links')).toBeInTheDocument();
    expect(screen.getByText('Coast drive')).toBeInTheDocument();
    expect(screen.queryByText('All upgrades applied')).not.toBeInTheDocument();
  });

  it('keeps both empty sections and the existing drive navigation without inventing success', async () => {
    vi.mocked(useVehicleUpgrades).mockReturnValue(query<UpgradesEnvelope>({
      data: { upgrades: [] }, fetched_at: null,
    }));
    vi.mocked(useShareLinks).mockReturnValue(query<ShareToken[]>([]));
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('0');
    expect(screen.getByText('Available upgrades')).toBeInTheDocument();
    expect(screen.getByText('This widget has no qualifying data yet.')).toBeInTheDocument();
    expect(screen.getByText('Share links')).toBeInTheDocument();
    expect(screen.getByText('No active share links')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drives' })).toHaveAttribute('href', '/drives');
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    expect(screen.queryByText('All upgrades applied')).not.toBeInTheDocument();
  });
});

it.each(sizes)('preserves Classic and recovers it after changing or receiving an unknown pack at $cols columns', async size => {
  const view = renderWidget('classic', size);
  const expectClassic = () => {
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    if (size.cols === 1) {
      expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
      expect(screen.getByText('available')).toBeInTheDocument();
      expect(screen.queryByText('Share links')).not.toBeInTheDocument();
    } else {
      expect(view.container.querySelector('.widget-big-number')).not.toBeInTheDocument();
      expect(screen.getByText('Acceleration Boost')).toBeInTheDocument();
      expect(screen.getByText('2,000.00')).toBeInTheDocument();
      expect(screen.getByText('Share links')).toBeInTheDocument();
      expect(screen.getByText('Coast drive')).toBeInTheDocument();
    }
  };
  expectClassic();
  view.selectPack('v7');
  await expectAppearance(view.container, 'pixel');
  view.selectPack('classic');
  expectClassic();
  view.selectPack('unsupported-pack');
  expectClassic();
});

it('retains sharing on an upgrades failure and retries only the failed source', async () => {
  vi.mocked(useVehicleUpgrades).mockReturnValue(query<UpgradesEnvelope>(undefined, {
    isError: true, error: new Error('Upgrades unavailable'), refetch: upgradeRefetch,
  }));
  const { container } = renderWidget('v2');
  await expectAppearance(container, 'elevated');
  expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
  expect(screen.getByText('Available upgrades')).toBeInTheDocument();
  expect(screen.getByText('Share links')).toBeInTheDocument();
  expect(screen.getByText('Coast drive')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  expect(upgradeRefetch).toHaveBeenCalledOnce();
  expect(driveRefetch).not.toHaveBeenCalled();
  expect(shareRefetch).not.toHaveBeenCalled();
});

it('retains upgrades on a sharing failure and retries its drive resolver and links', async () => {
  vi.mocked(useShareLinks).mockReturnValue(query<ShareToken[]>(undefined, {
    isError: true, error: new Error('Sharing unavailable'), refetch: shareRefetch,
  }));
  const { container } = renderWidget('v4');
  await expectAppearance(container, 'owner');
  expect(screen.getByText('Acceleration Boost')).toBeInTheDocument();
  expect(screen.getByText('Share links')).toBeInTheDocument();
  expect(screen.queryByText('No active share links')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  expect(upgradeRefetch).not.toHaveBeenCalled();
  expect(driveRefetch).toHaveBeenCalledOnce();
  expect(shareRefetch).toHaveBeenCalledOnce();
});

it('retains a failed-refresh payload, its warning, and invalid-expiry exclusions', async () => {
  vi.mocked(useVehicleUpgrades).mockReturnValue(query(upgrades, {
    isError: true, error: new Error('Refresh failed'), refetch: upgradeRefetch,
  }));
  vi.mocked(useShareLinks).mockReturnValue(query([
    share(), share({ id: 3, title: 'Unknown expiry', expires_at: 'invalid' }),
  ], { refetch: shareRefetch }));
  const { container } = renderWidget('v6');
  await expectAppearance(container, 'expressive');
  expect(screen.getByText('Acceleration Boost')).toBeInTheDocument();
  expect(screen.getByText('Coast drive')).toBeInTheDocument();
  expect(screen.queryByText('Unknown expiry')).not.toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
  expect(upgradeRefetch).toHaveBeenCalledOnce();
  expect(driveRefetch).toHaveBeenCalledOnce();
  expect(shareRefetch).toHaveBeenCalledOnce();
});

it('keeps invalid vehicle scope empty instead of displaying unrelated sharing', async () => {
  const { container } = renderWidget('v5', sizes[1], 0);
  await expectAppearance(container, 'iconic');
  expect(screen.getByText('No vehicle data')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Choose vehicle' })).toHaveAttribute('href', '/vehicles');
  expect(useVehicleUpgrades).toHaveBeenCalledWith(undefined);
  expect(useShareLinks).toHaveBeenCalledWith('');
  expect(screen.queryByText('Coast drive')).not.toBeInTheDocument();
  expect(screen.queryByText('Live')).not.toBeInTheDocument();
});

it('keeps an initial-loading shell without fabricated availability or sharing', () => {
  vi.mocked(useVehicleUpgrades).mockReturnValue(query<UpgradesEnvelope>(undefined, {
    isLoading: true, isPending: true, isFetching: true,
  }));
  const { container } = renderWidget('v1', sizes[0]);
  expect(screen.getByRole('heading', { name: 'Upgrades & Sharing' })).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  expect(container.querySelector('.widget-big-number')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.queryByText('Coast drive')).not.toBeInTheDocument();
});
