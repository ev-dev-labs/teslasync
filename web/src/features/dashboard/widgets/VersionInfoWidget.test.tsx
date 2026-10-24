import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      let text = typeof fallback === 'string' ? fallback : key;
      if (options) text = text.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) =>
        options[name] == null ? `{{${name}}}` : String(options[name]));
      return text;
    },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const hooks = vi.hoisted(() => ({ version: vi.fn(), capture: vi.fn() }));
vi.mock('@/api/hooks/useSettings', async (original) => {
  const actual = await original<typeof import('@/api/hooks/useSettings')>();
  return {
    ...actual,
    useVersionInfo: () => hooks.version(),
    useCaptureStats: () => hooks.capture(),
  };
});

window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

import VersionInfoWidget from './VersionInfoWidget';

function queryResult(data: unknown, over: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(cols = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VersionInfoWidget size={{ cols, rows: 2 }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hooks.version.mockReturnValue(queryResult({
    chart_version: '1.4.2',
    git_commit: 'abcdef0123456789',
    build_date: '2026-09-01',
    uptime_seconds: 90061,
    go_version: 'go1.25.0',
    os: 'linux',
    arch: 'amd64',
  }));
  hooks.capture.mockReturnValue(queryResult({
    capture_enabled: true,
    total_documents: 34567,
    distinct_vins: ['VIN-A', 'VIN-B'],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VersionInfoWidget After card', () => {
  it('renders source-backed version, build, uptime, and capture rows', () => {
    renderWidget(2);
    expect(screen.getByText('1.4.2')).toBeVisible();
    expect(screen.getByText('abcdef0')).toBeVisible();
    expect(screen.getByText('2026-09-01')).toBeVisible();
    expect(screen.getByText('1d 1h 1m')).toBeVisible();
    expect(screen.getByText('Enabled')).toBeVisible();
    expect(screen.getByText(/34,567 documents|34.567 documents/)).toBeVisible();
    expect(screen.getByText('2 VINs')).toBeVisible();
  });

  it('distinguishes a real zero uptime from missing data without fabricating uptime', () => {
    hooks.version.mockReturnValue(queryResult({ chart_version: '1.4.2', uptime_seconds: 0 }));
    renderWidget(2);
    expect(screen.getByText('0m')).toBeVisible();

    cleanup();
    hooks.version.mockReturnValue(queryResult({ chart_version: '1.4.2' }));
    renderWidget(2);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('keeps capture unknown when the real contract omits derived metrics', () => {
    hooks.capture.mockReturnValue(queryResult({
      mongodb_enabled: true,
      capture_enabled: true,
      total_documents: undefined,
      distinct_vins: null,
    }));
    renderWidget(4);
    expect(screen.getByText('Data capture')).toBeVisible();
    expect(screen.getByText('Enabled')).toBeVisible();
    expect(screen.queryByText(/signals\/sec/i)).not.toBeInTheDocument();
  });

  it('uses exactly the shell freshness ownership and compact identity layout', () => {
    const { container } = renderWidget(1);
    expect(screen.getByText('1.4.2')).toBeVisible();
    expect(screen.getByText('abcdef0')).toBeVisible();
    expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
    expect(screen.queryByText('Data capture')).not.toBeInTheDocument();
  });

  it('renders truthful loading and empty states', () => {
    hooks.version.mockReturnValue(queryResult(undefined, { isLoading: true }));
    const { container } = renderWidget(2);
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();

    cleanup();
    hooks.version.mockReturnValue(queryResult(null));
    renderWidget(2);
    expect(screen.getByText('No version data available')).toBeVisible();
  });
});
