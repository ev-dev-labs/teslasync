import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CommandLogEntry } from '@/api/hooks/useCommands';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : key;
        return template.replace(/{{(\w+)}}/g, (match, name: string) =>
          vars && name in vars ? String(vars[name]) : match);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/api/hooks/useCommands', () => ({ useCommandReliabilityHistory: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-01-01T00:00:00Z',
    endInstantExclusive: '2026-02-01T00:00:00Z',
  }),
}));
vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({ preferences: { defaultAnalysisRange: '30d' } }),
}));
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: () => 'UTC' };
});

import { useCommandReliabilityHistory } from '@/api/hooks/useCommands';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import CommandReliabilityPage from './CommandReliabilityPage';

const mockHistory = useCommandReliabilityHistory as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;

function query(data: CommandLogEntry[] | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data, isLoading: false, isFetching: false, isError: false,
    error: null, refetch: vi.fn(), ...overrides,
  };
}

function commands(): CommandLogEntry[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, vehicle_id: 7, command: 'lock', params: '',
      status: index < 2 ? 'success' : 'failed', error: index < 2 ? '' : 'Vehicle offline',
      created_at: new Date(Date.UTC(2026, 0, 15, 12, index)).toISOString(),
    })),
    {
      id: 6, vehicle_id: 7, command: 'honk_horn', params: '',
      status: 'pending', error: '', created_at: '2026-01-15T13:00:00Z',
    },
  ];
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/command-reliability']}>
        <CommandReliabilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function band() {
  return screen.getByRole('region', { name: 'Command reliability metrics' });
}

function stat(label: string) {
  const element = within(band()).getByText(label).closest('[data-operational-metric]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing genuine operational metric: ${label}`);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVehicle.mockReturnValue({ vehicleId: 7 });
  mockHistory.mockReturnValue(query([]));
});

describe('CommandReliabilityPage — genuine summary OperationalBrief', () => {
  it('preserves the zero-attempt record and every original caption and section', () => {
    renderPage();
    expect(band().querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(band().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(stat('Overall success').querySelector('[data-operational-value]')).toHaveTextContent('0%');
    expect(stat('Overall success')).toHaveTextContent('0 attempts');
    expect(stat('Unreliable commands')).toHaveTextContent('Nothing failing');
    expect(stat('Distinct intents')).toHaveTextContent('after collapsing retry storms');
    expect(stat('Retry storms')).toHaveTextContent('you pressed it again, and again');
    expect(band().querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
    expect(screen.getByText('No remote commands have been issued yet, so there is no reliability record to grade.')).toBeInTheDocument();
    expect(screen.getByText('No commands recorded yet.')).toBeInTheDocument();
    expect(mockHistory).toHaveBeenCalledWith(7, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    fireEvent.click(within(band()).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('after collapsing retry storms')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('you pressed it again, and again')).toBeInTheDocument();
  });

  it('preserves resolved-success rates, all attempts and collapsed retry-intent definitions', () => {
    mockHistory.mockReturnValue(query(commands()));
    renderPage();
    expect(stat('Overall success').querySelector('[data-operational-value]')).toHaveTextContent('40%');
    expect(stat('Overall success')).toHaveTextContent('6 attempts');
    expect(stat('Unreliable commands').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(stat('Unreliable commands')).toHaveTextContent('Lock');
    expect(stat('Distinct intents').querySelector('[data-operational-value]')).toHaveTextContent('2');
    expect(stat('Retry storms').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: 'Confidence-weighted success' })).toBeInTheDocument();
    expect(screen.getByText('2 ok · 3 failed')).toBeInTheDocument();
    expect(screen.getByText('5 · 1 retried')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
  });

  it('keeps loading and missing sources distinct from measured zero', () => {
    mockHistory.mockReturnValue(query(undefined, { isLoading: true }));
    const view = renderPage();
    expect(band().querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(band().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(band().querySelector('[data-operational-value]')).not.toBeInTheDocument();
    view.unmount();
    mockHistory.mockReturnValue(query(undefined));
    renderPage();
    expect(band().querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(within(band()).queryByText('0 attempts')).not.toBeInTheDocument();
    expect(within(band()).queryByText('Nothing failing')).not.toBeInTheDocument();
  });

  it('keeps retained values, source warning and the existing retry action on refresh failure', () => {
    const refetch = vi.fn();
    mockHistory.mockReturnValue(query(commands(), { error: new Error('refresh failed'), refetch }));
    renderPage();
    expect(within(band()).getByText('Data may be stale')).toBeInTheDocument();
    expect(stat('Overall success')).toHaveTextContent('6 attempts');
    expect(screen.getAllByText(/Previously loaded data remains visible/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
  });

  it('retains the fatal source retry rather than fabricating summary values', () => {
    const refetch = vi.fn();
    mockHistory.mockReturnValue(query(undefined, { error: new Error('failed'), refetch }));
    renderPage();
    expect(band().querySelector('[data-operational-metric]')).not.toBeInTheDocument();
    fireEvent.click(within(band()).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
