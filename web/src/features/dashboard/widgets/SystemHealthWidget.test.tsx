import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
import SystemHealthWidget, { formatUptime, overallBadgeStatus, statusTier } from './SystemHealthWidget';

const mockHealth = useSystemHealth as ReturnType<typeof vi.fn>;
const mockPool = useConnectionPool as ReturnType<typeof vi.fn>;
const mockVersion = useVersionInfo as ReturnType<typeof vi.fn>;
const mockDB = useDBStats as ReturnType<typeof vi.fn>;

const query = (data?: unknown, over: Record<string, unknown> = {}) => ({
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
  mockPool.mockReturnValue(query({ inUse: 18, maxOpen: 100, memoryMB: 512 }));
  mockDB.mockReturnValue(query({ databaseSize: '2.4 GB' }));
  mockVersion.mockReturnValue(query({ uptime_seconds: 1_036_800 }));
}

function renderWidget(cols = 2) {
  return render(
    <MemoryRouter>
      <SystemHealthWidget size={{ cols, rows: 4 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe('SystemHealthWidget redesign', () => {
  it('maps known statuses without manufacturing unknown readings', () => {
    expect(statusTier('healthy')).toBe('ok');
    expect(statusTier('warning')).toBe('degraded');
    expect(statusTier(null)).toBe('unknown');
    expect(statusTier('offline')).toBe('down');
    expect(statusTier('new-status')).toBe('unknown');
    expect(overallBadgeStatus('healthy')).toBe('online');
    expect(overallBadgeStatus('degraded')).toBe('away');
  });

  it('renders the After hierarchy with status grid and three secondary values', () => {
    renderWidget();

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
    expect(screen.getAllByText('Healthy').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('shows honest placeholders for missing readings', () => {
    mockPool.mockReturnValue(query(undefined));
    mockVersion.mockReturnValue(query(undefined));
    renderWidget();

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('0 MB')).not.toBeInTheDocument();
  });

  it('renders the compact badge and services summary only', () => {
    renderWidget(1);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.queryByText('DB size')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory')).not.toBeInTheDocument();
  });

  it('renders a useful empty state and refetches all real sources', () => {
    const healthRefetch = vi.fn();
    const poolRefetch = vi.fn();
    const versionRefetch = vi.fn();
    mockHealth.mockReturnValue(query(undefined, { isError: false, refetch: healthRefetch }));
    mockPool.mockReturnValue(query(undefined, { refetch: poolRefetch }));
    mockVersion.mockReturnValue(query(undefined, { refetch: versionRefetch }));
    renderWidget();

    expect(screen.getByText('No system health data')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(healthRefetch).toHaveBeenCalledOnce();
    expect(poolRefetch).toHaveBeenCalledOnce();
    expect(versionRefetch).toHaveBeenCalledOnce();
  });
});
