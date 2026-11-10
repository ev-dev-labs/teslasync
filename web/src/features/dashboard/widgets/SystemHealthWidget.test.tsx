import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: vi.fn(),
  useConnectionPool: vi.fn(),
  useDBStats: vi.fn(),
}));
vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: vi.fn(),
}));

import { useSystemHealth, useConnectionPool } from '@/api/hooks/useAdmin';
import { useDBStats } from '@/api/hooks/useAdmin';
import { useVersionInfo } from '@/api/hooks/useSettings';
import SystemHealthWidget, { overallBadgeStatus, statusTier } from './SystemHealthWidget';

const mockHealth = useSystemHealth as ReturnType<typeof vi.fn>;
const mockPool = useConnectionPool as ReturnType<typeof vi.fn>;
const mockVersion = useVersionInfo as ReturnType<typeof vi.fn>;
const mockDB = useDBStats as ReturnType<typeof vi.fn>;

const query = <T,>(data?: T, over: Partial<Omit<DataStateSource<T>, 'data'>> = {}) => ({
  data,
  error: null,
  isLoading: false,
  isFetching: false,
  isStale: false,
  isError: false,
  dataUpdatedAt: Date.now(),
  refetch: vi.fn(),
  ...over,
});

const health = (status = 'healthy') => ({
  status,
  databaseSize: '2.4 GB',
  components: {
    database: { status: 'healthy' },
    mqtt: { status: 'healthy' },
    tesla_api: { status: 'warning' },
    fleet_telemetry: { status: 'healthy' },
  },
});

function setup() {
  mockHealth.mockReturnValue(query(health()));
  mockPool.mockReturnValue(query({ inUse: 18, maxOpen: 100, memoryMB: 512, goroutines: 32 }));
  mockDB.mockReturnValue(query({ databaseSize: '2.4 GB' }));
  mockVersion.mockReturnValue(query({ uptime_seconds: 1_036_800 }));
}

function widgetTree(cols: number, packId: PackId) {
  return <MemoryRouter>
    <PackBoundary requestedPackId={packId}>
      <SystemHealthWidget size={{ cols, rows: 4 }} />
    </PackBoundary>
  </MemoryRouter>;
}

async function renderWidget(cols: number, packId: PackId, contentVisible = true) {
  const view = render(widgetTree(cols, packId));
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (contentVisible && packId !== 'classic') {
    await waitFor(() => expect(view.container.querySelector('[data-status-appearance]'))
      .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]));
  }
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

it('maps known statuses without manufacturing unknown readings', () => {
  expect(statusTier('healthy')).toBe('ok');
  expect(statusTier('warning')).toBe('degraded');
  expect(statusTier(null)).toBe('unknown');
  expect(statusTier('offline')).toBe('down');
  expect(statusTier('new-status')).toBe('unknown');
  expect(overallBadgeStatus('healthy')).toBe('online');
  expect(overallBadgeStatus('degraded')).toBe('away');
});

describe.each(PACK_IDS)('SystemHealthWidget %s', (packId) => {
  it('retains the service grid and all runtime readings in the shared presentation', async () => {
    const { container } = await renderWidget(2, packId);

    expect(screen.getByRole('heading', { name: 'System health' })).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('MQTT')).toBeInTheDocument();
    expect(screen.getByText('Tesla API')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText('Server uptime')).toBeInTheDocument();
    expect(screen.getByText('12d 0h 0m')).toBeInTheDocument();
    expect(screen.getByText('Active conns')).toBeInTheDocument();
    expect(screen.getByText('18/100')).toBeInTheDocument();
    expect(screen.getByText('DB size')).toBeInTheDocument();
    expect(screen.getByText('2.4 GB')).toBeInTheDocument();
    expect(screen.getByText('Goroutines')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getAllByText('Healthy').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('shows honest placeholders for missing readings', async () => {
    mockPool.mockReturnValue(query(undefined));
    mockVersion.mockReturnValue(query(undefined));
    await renderWidget(2, packId);

    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0 MB')).not.toBeInTheDocument();
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
  });

  it('renders the compact badge and services summary only', async () => {
    await renderWidget(1, packId);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('services')).toBeInTheDocument();
    expect(screen.queryByText('DB size')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory')).not.toBeInTheDocument();
    expect(screen.queryByText('Database')).not.toBeInTheDocument();
  });

  it('renders a useful empty state and refetches all four real sources', async () => {
    const healthRefetch = vi.fn();
    const poolRefetch = vi.fn();
    const dbRefetch = vi.fn();
    const versionRefetch = vi.fn();
    mockHealth.mockReturnValue(query(undefined, { isError: false, refetch: healthRefetch }));
    mockPool.mockReturnValue(query(undefined, { refetch: poolRefetch }));
    mockDB.mockReturnValue(query(undefined, { refetch: dbRefetch }));
    mockVersion.mockReturnValue(query(undefined, { refetch: versionRefetch }));
    await renderWidget(2, packId);

    expect(screen.getByText('No system health data')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('0 MB')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(healthRefetch).toHaveBeenCalledOnce();
    expect(poolRefetch).toHaveBeenCalledOnce();
    expect(dbRefetch).toHaveBeenCalledOnce();
    expect(versionRefetch).toHaveBeenCalledOnce();
  });

  it('keeps real zero readings and byte-based memory units intact', async () => {
    mockPool.mockReturnValue(query({ memory: { alloc_bytes: 0 }, in_use: 0, max_open: 0, goroutines: 0 }));
    mockVersion.mockReturnValue(query({ uptime_seconds: 0 }));
    const view = await renderWidget(2, packId);

    expect(screen.getByText('0 MB')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();

    mockPool.mockReturnValue(query({ memory: { alloc_bytes: 512 * 1024 * 1024 }, in_use: 0, max_open: 100, goroutines: 0 }));
    view.rerender(widgetTree(2, packId));
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText('0/100')).toBeInTheDocument();
  });

  it('keeps unknown and down services distinct from invalid runtime readings', async () => {
    mockHealth.mockReturnValue(query({
      ...health('unreported'),
      components: {
        database: { status: 'new-status' },
        mqtt: { status: '' },
        tesla_api: { status: 'offline' },
        fleet_telemetry: { status: 'warning' },
      },
    }));
    mockPool.mockReturnValue(query({ memoryMB: Number.NaN, goroutines: Number.POSITIVE_INFINITY, inUse: Number.NaN }));
    mockVersion.mockReturnValue(query({ uptime_seconds: -1 }));
    const { container } = await renderWidget(2, packId);

    expect(screen.getByText('Database').closest('[role="listitem"]')).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('MQTT').closest('[role="listitem"]')).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('Tesla API').closest('[role="listitem"]')).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('Fleet Telemetry').closest('[role="listitem"]')).toHaveAttribute('data-status', 'warning');
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/NaN|Infinity|0 MB|0m/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('preserves initial loading without claiming healthy services or zero measurements', async () => {
    for (const mock of [mockHealth, mockPool, mockDB, mockVersion]) {
      mock.mockReturnValue(query(undefined, { isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    }
    const { container } = await renderWidget(2, packId, false);

    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'System health' })).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('0 MB')).not.toBeInTheDocument();
    expect(screen.queryByText('No system health data')).not.toBeInTheDocument();
  });

  it('preserves fatal failure and retries all sources instead of displaying invented health', async () => {
    const refetches = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    [mockHealth, mockPool, mockDB, mockVersion].forEach((mock, index) => {
      mock.mockReturnValue(query(undefined, {
        isError: true, error: new Error('Health source failed'), refetch: refetches[index], dataUpdatedAt: 0,
      }));
    });
    const { container } = await renderWidget(2, packId, false);

    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('0 MB')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    for (const refetch of refetches) expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains partial source content while switching packs and refreshes without remounting controls', async () => {
    const healthRefetch = vi.fn();
    const refetches = [healthRefetch, vi.fn(), vi.fn(), vi.fn()];
    mockHealth.mockReturnValue(query(health(), { isError: true, error: new Error('Refresh failed'), refetch: healthRefetch }));
    mockPool.mockReturnValue(query({ memoryMB: 512, inUse: 18, maxOpen: 100 }, { refetch: refetches[1] }));
    mockDB.mockReturnValue(query(undefined, { isError: true, error: new Error('DB stats failed'), refetch: refetches[2] }));
    mockVersion.mockReturnValue(query({ uptime_seconds: 1_036_800 }, { refetch: refetches[3] }));
    const view = await renderWidget(2, 'classic');
    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    refresh.focus();

    view.rerender(widgetTree(2, packId));
    if (packId !== 'classic') {
      await waitFor(() => expect(view.container.querySelector('[data-status-appearance]'))
        .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]));
    }

    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    for (const value of ['Database', '2.4 GB', '512 MB', '18/100', '12d 0h 0m']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBe(refresh);
    expect(refresh).toHaveFocus();
    for (const refetch of refetches) expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    for (const refetch of refetches) expect(refetch).toHaveBeenCalledOnce();
  });
});
