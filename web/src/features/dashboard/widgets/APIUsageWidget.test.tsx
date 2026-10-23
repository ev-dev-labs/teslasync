import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { APICallLogStats } from '@/types/admin';
import APIUsageWidget from './APIUsageWidget';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
});

const { useApiLogStatsMock } = vi.hoisted(() => ({ useApiLogStatsMock: vi.fn() }));

vi.mock('@/api/hooks/useAdmin', () => ({
  useApiLogStats: () => useApiLogStatsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

function makeStats(overrides: Partial<APICallLogStats> = {}): APICallLogStats {
  return {
    totalCalls: 18400,
    last24h: 18400,
    avgDurationMs: 142,
    errorRate: 0.3,
    errorCount: 55,
    ...overrides,
  };
}

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(cols = 2) {
  return render(
    <MemoryRouter>
      <APIUsageWidget size={{ cols, rows: 2 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useApiLogStatsMock.mockReturnValue(makeQuery());
});

afterEach(cleanup);

describe('APIUsageWidget', () => {
  it('matches the After hierarchy with three source-backed metrics and no fabricated endpoint data', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({ data: makeStats() }));
    renderWidget(2);

    expect(screen.getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('18,400')).toBeInTheDocument();
    expect(screen.getByText('Avg response')).toBeInTheDocument();
    expect(screen.getByText('142.00')).toBeInTheDocument();
    expect(screen.getByText('ms')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('0.30')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.queryByText(/Top:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/High/)).not.toBeInTheDocument();
  });

  it('uses one compact headline and preserves unknown readings as unavailable', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ last24h: 999, avgDurationMs: Number.NaN }),
    }));
    renderWidget(1);

    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    expect(screen.queryByText('Avg response')).not.toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('renders loading, empty, and initial-error states without inventing zeroes', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({ isLoading: true }));
    const { container, rerender } = renderWidget(2);
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');

    useApiLogStatsMock.mockReturnValue(makeQuery());
    rerender(<MemoryRouter><APIUsageWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByText('No API usage data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    useApiLogStatsMock.mockReturnValue(makeQuery({ isError: true, error: new Error('boom') }));
    rerender(<MemoryRouter><APIUsageWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });

  it('retains measured data during a background refresh error', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ last24h: 8888 }),
      isError: true,
      error: new Error('refresh failed'),
    }));
    renderWidget(2);

    expect(screen.getByText('8,888')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('wires the shared FreshnessDot refresh control', () => {
    const refetch = vi.fn();
    useApiLogStatsMock.mockReturnValue(makeQuery({
      data: makeStats(),
      dataUpdatedAt: Date.now(),
      refetch,
    }));
    renderWidget(2);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate zeroes for partial source data', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({ data: {} as APICallLogStats }));
    renderWidget(2);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });
});
