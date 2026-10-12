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

  describe('CommandReliabilityPage source trust and complete chart evidence', () => {
    it('shows source failure and read retry in every section without empty-history claims', () => {
      const refetch = vi.fn();
      mockHistory.mockReturnValue(query(undefined, { error: new Error('History unavailable'), refetch }));
      renderPage();
      expect(screen.getByRole('heading', { name: 'Confidence-weighted success' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
      expect(screen.queryByText('No commands recorded yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('No remote commands have been issued yet, so there is no reliability record to grade.')).not.toBeInTheDocument();
      const retries = screen.getAllByRole('button', { name: 'Retry' });
      expect(retries).toHaveLength(3);
      retries.forEach((button) => fireEvent.click(button));
      expect(refetch).toHaveBeenCalledTimes(3);
    });

    it('keeps an initially paused read unknown rather than claiming no records', () => {
      mockHistory.mockReturnValue(query(undefined, { isPending: true, fetchStatus: 'paused' }));
      renderPage();
      expect(screen.getAllByText('Command outcomes unavailable')).toHaveLength(3);
      expect(screen.queryByText('No attempts recorded')).not.toBeInTheDocument();
      expect(screen.queryByText('No commands recorded yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('No remote commands have been issued yet, so there is no reliability record to grade.')).not.toBeInTheDocument();
      expect(band().querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
      expect(screen.queryByText('Nothing failing')).not.toBeInTheDocument();
    });

    it('retains paused history and every confidence row without replacing it with empty content', () => {
      const data = commands();
      const original = structuredClone(data);
      mockHistory.mockReturnValue(query(data, { fetchStatus: 'paused', isPending: false }));
      renderPage();
      expect(stat('Overall success')).toHaveTextContent('40%');
      expect(within(band()).getByText('Data may be stale')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText('Lock')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText('Honk horn')).toBeInTheDocument();
      expect(screen.getByText('2 ok · 3 failed')).toBeInTheDocument();
      expect(data).toEqual(original);
    });

    it('preserves full colliding command names in the fallback table and CSV action', () => {
      mockHistory.mockReturnValue(query([
        { id: 41, vehicle_id: 7, command: 'command_prefix_shares_twenty_four_chars_alpha', params: '', status: 'failed', error: '', created_at: '2026-01-15T12:00:00Z' },
        { id: 42, vehicle_id: 7, command: 'command_prefix_shares_twenty_four_chars_beta', params: '', status: 'success', error: '', created_at: '2026-01-15T12:01:00Z' },
      ]));
      renderPage();
      const table = screen.getByRole('table');
      expect(within(table).getByText('Command prefix shares twenty four chars alpha')).toBeInTheDocument();
      expect(within(table).getByText('Command prefix shares twenty four chars beta')).toBeInTheDocument();
      expect(within(table).getAllByRole('row')).toHaveLength(3);
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      expect(screen.getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Save as SVG' })).toBeInTheDocument();
    });

    it('distinguishes pending-only confidence from measured zero success in the chart and detail', () => {
      mockHistory.mockReturnValue(query([
        { id: 51, vehicle_id: 7, command: 'wake_up', params: '', status: 'pending', error: '', created_at: '2026-01-15T12:00:00Z' },
        { id: 52, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error: '', created_at: '2026-01-15T12:01:00Z' },
      ]));
      renderPage();
      const table = screen.getByRole('table');
      const pending = within(table).getByText('Wake up').closest('tr');
      const failure = within(table).getByText('Lock').closest('tr');
      if (!pending || !failure) throw new Error('Missing original command rows');
      expect(within(pending).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
        'Wake up', '—', '—', '—', '1', 'unproven',
      ]);
      expect(within(failure).getAllByRole('cell')[2]).toHaveTextContent('0');
      const detail = screen.getAllByText('Wake up').find((node) => node.closest('li'))?.closest('li');
      if (!detail) throw new Error('Missing pending command detail');
      const interval = within(detail).getByText('95 % interval');
      expect(interval.tagName).toBe('DT');
      expect(interval.nextElementSibling).toHaveTextContent('Unknown');
      expect(interval.nextElementSibling?.tagName).toBe('DD');
    });

    it('keeps full normalized failure evidence in semantic definition pairs', () => {
      const error = 'FailureSignature'.repeat(8);
      mockHistory.mockReturnValue(query([
        { id: 61, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error, created_at: '2026-01-15T12:00:00Z' },
      ]));
      renderPage();
      const label = screen.getByText('Usual failure');
      expect(label.tagName).toBe('DT');
      expect(label.nextElementSibling?.tagName).toBe('DD');
      expect(label.nextElementSibling).toHaveTextContent(`${error.slice(0, 120)} (×1)`);
      expect(label.nextElementSibling).toHaveClass('min-w-0', 'break-words', 'text-[var(--semantic-danger)]');
      expect(screen.getByText('0 ok · 1 failed')).toBeInTheDocument();
    });

    it('uses the vehicle timezone for range, last-used date and retained fetch time', async () => {
      const timezone = await import('@/lib/timezone');
      const zone = vi.spyOn(timezone, 'useTimezone').mockReturnValue('America/Los_Angeles');
      try {
        mockHistory.mockReturnValue(query([
          { id: 71, vehicle_id: 7, command: 'lock', params: '', status: 'success', error: '', created_at: '2026-01-15T00:30:00Z' },
        ], { dataUpdatedAt: Date.UTC(2026, 0, 15, 0, 30) }));
        renderPage();
        const date = screen.getByText('Last used').nextElementSibling;
        expect(date).toHaveTextContent('Jan 14');
        expect(band()).toHaveTextContent('Dec 31, 2025');
        expect(band()).toHaveTextContent('Jan 14, 2026');
        expect(mockHistory).toHaveBeenCalledWith(7, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
      } finally {
        zone.mockRestore();
      }
    });
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
