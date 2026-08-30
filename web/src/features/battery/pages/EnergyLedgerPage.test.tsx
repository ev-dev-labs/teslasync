import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  sessions: {
    current: null as unknown as FakeQuery<unknown[]>,
  },
  drives: {
    current: null as unknown as FakeQuery<unknown[]>,
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

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: () => H.sessions.current,
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => H.drives.current,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatEnergy: (value: number) => `${value} Wh`,
    formatPower: (value: number) => `${value} W`,
    formatDistance: (value: number) => `${value} m`,
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
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

import EnergyLedgerPage from './EnergyLedgerPage';

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EnergyLedgerPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  H.sessions.current = query({ data: [], isSuccess: true });
  H.drives.current = query({
    isError: true,
    error: new Error('drive history offline'),
  });
});

describe('EnergyLedgerPage partial-data contract', () => {
  it('names the failed source, preserves the page, and retries only that source', () => {
    renderPage();

    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Charging history')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Drive history')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Month by Month')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(H.drives.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.sessions.current.refetch).not.toHaveBeenCalled();
  });
});
