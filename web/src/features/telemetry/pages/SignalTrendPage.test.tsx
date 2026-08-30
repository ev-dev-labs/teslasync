import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalHistoryResponse } from '@/types/telemetry';

interface FakeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: Error | null;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

const H = vi.hoisted(() => ({
  signals: {
    current: null as unknown as FakeQuery<string[]>,
  },
  history: {
    current: null as unknown as FakeQuery<SignalHistoryResponse>,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: unknown, options?: unknown) => {
      const fallback = typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : typeof fallbackOrOptions === 'object'
          && fallbackOrOptions !== null
          && 'defaultValue' in fallbackOrOptions
          ? String((fallbackOrOptions as { defaultValue: unknown }).defaultValue)
          : _key;
      const values = (
        typeof options === 'object' && options !== null
          ? options
          : fallbackOrOptions
      ) as Record<string, unknown> | undefined;
      return values
        ? Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
            fallback,
          )
        : fallback;
    },
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => H.signals.current,
  useSignalAnalysisHistory: () => H.history.current,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useHiddenSeries', () => ({
  useHiddenSeries: () => ({
    isHidden: () => false,
    toggle: vi.fn(),
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    children,
  }: {
    title: string;
    children?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  ChartTooltip: () => null,
  ChartLegend: () => null,
  ComposedChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Line: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import SignalTrendPage from './SignalTrendPage';

function query<T>(overrides: Partial<FakeQuery<T>> = {}): FakeQuery<T> {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isSuccess: false,
    isError: false,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function historyResponse(): SignalHistoryResponse {
  return {
    vehicleId: 7,
    signal: 'BatteryLevel',
    from: '2026-01-01T00:00:00Z',
    to: '2026-01-05T00:00:00Z',
    count: 5,
    data: [
      { timestamp: '2026-01-01T00:00:00Z', valueNum: 50 },
      { timestamp: '2026-01-02T00:00:00Z', valueNum: 51 },
      { timestamp: '2026-01-03T00:00:00Z', valueNum: 52 },
      { timestamp: '2026-01-04T00:00:00Z', valueNum: 53 },
      { timestamp: '2026-01-05T00:00:00Z', valueNum: 54 },
    ],
  };
}

function pageElement(client: QueryClient) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SignalTrendPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  H.signals.current = query({
    data: ['BatteryLevel'],
    isSuccess: true,
  });
  H.history.current = query({
    data: historyResponse(),
    isSuccess: true,
  });
});

describe('SignalTrendPage partial-data contract', () => {
  it('retains selected history when the cached signal catalog refresh fails', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const page = render(pageElement(client));

    fireEvent.change(screen.getByRole('combobox', { name: 'Signal' }), {
      target: { value: 'BatteryLevel' },
    });
    expect(screen.getByText('Samples')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    H.signals.current = query({
      data: ['BatteryLevel'],
      isError: true,
      error: new Error('catalog refresh failed'),
    });
    page.rerender(pageElement(client));

    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.getByText('Signal catalog')).toBeInTheDocument();
    expect(screen.getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(screen.getByText('Selected signal history')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Robust Baseline & Forecast Band')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(H.signals.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.history.current.refetch).not.toHaveBeenCalled();
  });
});
