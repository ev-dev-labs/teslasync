import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SystemHealth, SystemHealthComponent } from '@/types/admin';
import UptimeMonitorWidget, { classifyStatus } from './UptimeMonitorWidget';

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

const { useSystemHealthMock } = vi.hoisted(() => ({ useSystemHealthMock: vi.fn() }));
vi.mock('@/api/hooks/useAdmin', () => ({ useSystemHealth: () => useSystemHealthMock() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? ''))
        : template;
    },
  }),
}));

function component(overrides: Partial<SystemHealthComponent> = {}): SystemHealthComponent {
  return { status: 'healthy', consecutiveFailures: 0, lastError: null, details: {}, ...overrides };
}

function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    status: 'healthy',
    components: {
      database: component(),
      mqtt: component(),
      tesla_api: component(),
      fleet_telemetry: component(),
    },
    databaseSize: '128 MB',
    tableCount: 42,
    ...overrides,
  };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size = { cols: 2, rows: 2 }) {
  return render(<MemoryRouter><UptimeMonitorWidget size={size} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSystemHealthMock.mockReturnValue(query());
});
afterEach(cleanup);

describe('UptimeMonitorWidget After card', () => {
  it('classifies known statuses and fails unknown non-empty values closed', () => {
    expect(classifyStatus('healthy')).toBe('success');
    expect(classifyStatus('warning')).toBe('warning');
    expect(classifyStatus('offline')).toBe('danger');
    expect(classifyStatus('unknown')).toBe('unknown');
    expect(classifyStatus(null)).toBe('unknown');
    expect(classifyStatus('new-bad-state')).toBe('danger');
  });

  it('renders one status row for each real service without extra date or database labels', () => {
    useSystemHealthMock.mockReturnValue(query({ data: health() }));
    renderWidget();

    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('MQTT')).toBeInTheDocument();
    expect(screen.getByText('Tesla API')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(4);
    expect(screen.queryByText('Overall')).not.toBeInTheDocument();
    expect(screen.queryByText('DB size')).not.toBeInTheDocument();
    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
  });

  it('uses dot and word status, mapping degraded, unknown, and down without raw leakage', () => {
    useSystemHealthMock.mockReturnValue(query({
      data: health({ components: {
        database: component({ status: 'degraded' }),
        mqtt: component({ status: 'unknown' }),
        tesla_api: component({ status: 'offline' }),
        fleet_telemetry: component(),
      } }),
    }));
    renderWidget({ cols: 3, rows: 2 });

    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.getByText('Database').closest('.relative')?.querySelector('[aria-hidden="true"]'))
      .toHaveClass('bg-[var(--semantic-warning)]');
  });

  it('shows measured failure and error details, while zero failures add no fabricated detail', () => {
    useSystemHealthMock.mockReturnValue(query({
      data: health({ components: {
        database: component({ status: 'degraded', consecutiveFailures: 3, lastError: 'connection refused' }),
        mqtt: component(), tesla_api: component(), fleet_telemetry: component(),
      } }),
    }));
    renderWidget();
    const database = screen.getByText('Database').closest('.relative');
    expect(database).not.toBeNull();
    expect(within(database as HTMLElement).getByText(/×3 consecutive failures/)).toBeInTheDocument();
    expect(within(database as HTMLElement).getByText(/connection refused/)).toBeInTheDocument();
  });

  it('keeps absent components unknown, not healthy or down', () => {
    useSystemHealthMock.mockReturnValue(query({ data: health({ components: {} }) }));
    renderWidget();
    expect(screen.getAllByText('Unknown')).toHaveLength(4);
    expect(screen.queryByText('Down')).not.toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  it('renders the compact healthy count in the 1-column After layout', () => {
    useSystemHealthMock.mockReturnValue(query({
      data: health({ components: {
        database: component({ status: 'degraded' }),
        mqtt: component(), tesla_api: component(), fleet_telemetry: component(),
      } }),
    }));
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('Services healthy')).toBeInTheDocument();
    expect(screen.queryByText('Database')).not.toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget source states and freshness', () => {
  it('shows the loading shell and a useful empty state', () => {
    useSystemHealthMock.mockReturnValue(query({ isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('No system health data')).not.toBeInTheDocument();

    cleanup();
    useSystemHealthMock.mockReturnValue(query());
    renderWidget();
    expect(screen.getByText('No system health data')).toBeInTheDocument();
  });

  it('uses the full error panel only for an initial failure', () => {
    useSystemHealthMock.mockReturnValue(query({ error: new Error('boom'), isError: true }));
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });

  it('retains cached status on refresh failure and exposes an error dot through FreshnessDot', () => {
    useSystemHealthMock.mockReturnValue(query({
      data: health(),
      error: new Error('transient'),
      isError: true,
      dataUpdatedAt: Date.now(),
    }));
    renderWidget();
    expect(screen.getAllByText('OK')).toHaveLength(4);
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh data · error · just now/ }).querySelector('[aria-hidden="true"].rounded-full'))
      .toHaveClass('bg-[var(--semantic-danger)]');
  });

  it('refreshes only while idle', () => {
    const refetch = vi.fn();
    useSystemHealthMock.mockReturnValue(query({ data: health(), isFetching: false, refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    cleanup();
    useSystemHealthMock.mockReturnValue(query({ data: health(), isFetching: true, refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
